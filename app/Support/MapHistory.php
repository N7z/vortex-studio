<?php

namespace App\Support;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class MapHistory
{
    public const SAVE = 'save';

    public const DESTRUCTIVE = 'destructive';

    public const PRE_DELETE = 'pre_delete';

    public const PRE_RESTORE = 'pre_restore';

    public const MANUAL = 'manual';

    private const MIN_GAP = 300;

    private const BIG_DELTA_PARTS = 200;

    private const BIG_DELTA_RATIO = 0.05;

    private const KEEP_ALL = 24 * 3600;

    private const KEEP_HOURLY = 7 * 86400;

    private const KEEP_DAILY = 30 * 86400;

    private const KEEP_MIN = 3;

    private const MAX_PER_MAP = 200;

    private static function disk()
    {
        return Storage::disk();
    }

    private static function path(int $mapId, string $key): string
    {
        return "snapshots/$mapId/$key.json.gz";
    }

    public static function snapshot(object $map, string $reason = self::SAVE, ?int $newParts = null): ?int
    {
        $data = (string) ($map->data ?? '');
        if ($data === '' || $data === '[]') {
            return null;
        }

        $doc = '{"parts":'.$data.',"groups":'.($map->groups ?: '[]').'}';
        $hash = hash('sha256', $doc);

        $last = DB::table('map_versions')->where('map_id', $map->id)
            ->orderByDesc('id')->first(['id', 'hash', 'parts', 'created_at']);

        if ($last && $last->hash === $hash) {
            if ($reason === self::MANUAL) {
                DB::table('map_versions')->where('id', $last->id)->update(['reason' => self::MANUAL]);
            }

            return (int) $last->id;
        }
        if ($reason === self::SAVE && ! self::worthKeeping($last, $map, $newParts)) {
            return null;
        }

        $key = bin2hex(random_bytes(16));
        $blob = gzencode($doc, 6);
        if (! self::disk()->put(self::path((int) $map->id, $key), $blob)) {
            Log::warning('snapshot write failed', ['map' => $map->id, 'reason' => $reason]);

            return null;
        }

        $id = DB::table('map_versions')->insertGetId([
            'map_id' => $map->id,
            'version' => (int) $map->version,
            'user_id' => $map->saved_by ?? $map->user_id,
            'reason' => $reason,
            'parts' => (int) $map->parts,
            'bytes' => strlen($blob),
            'hash' => $hash,
            'storage_key' => $key,
            'created_at' => now(),
        ]);

        self::prune((int) $map->id);

        return $id;
    }

    private static function worthKeeping(?object $last, object $map, ?int $newParts): bool
    {
        if (! $last) {
            return true;
        }

        if ((int) ($map->saved_by ?? 0) !== (int) (Auth::id() ?? 0)) {
            return true;
        }

        if (strtotime((string) $last->created_at) <= time() - self::MIN_GAP) {
            return true;
        }

        $was = (int) $map->parts;
        $delta = abs(($newParts ?? $was) - $was);

        return $delta >= max(self::BIG_DELTA_PARTS, (int) ($was * self::BIG_DELTA_RATIO));
    }

    public static function versions(int $mapId): array
    {
        return DB::table('map_versions')
            ->leftJoin('users', 'users.id', '=', 'map_versions.user_id')
            ->where('map_versions.map_id', $mapId)
            ->orderByDesc('map_versions.id')
            ->limit(self::MAX_PER_MAP)
            ->get([
                'map_versions.id', 'map_versions.version', 'map_versions.reason',
                'map_versions.parts', 'map_versions.bytes', 'map_versions.created_at',
                'users.name as by',
            ])
            ->map(fn ($v) => [
                'id' => (int) $v->id,
                'version' => (int) $v->version,
                'reason' => $v->reason,
                'parts' => (int) $v->parts,
                'bytes' => (int) $v->bytes,
                'at' => strtotime((string) $v->created_at),
                'by' => $v->by,
            ])
            ->all();
    }

    public static function document(int $mapId, int $versionId): ?array
    {
        $row = DB::table('map_versions')
            ->where('map_id', $mapId)->where('id', $versionId)->first(['storage_key']);
        if (! $row) {
            return null;
        }

        try {
            $blob = self::disk()->get(self::path($mapId, $row->storage_key));
        } catch (\Throwable) {
            return null;
        }

        $doc = is_string($blob) ? @gzdecode($blob) : null;
        $parsed = is_string($doc) ? json_decode($doc, true) : null;

        return is_array($parsed) && is_array($parsed['parts'] ?? null) ? $parsed : null;
    }

    public static function prune(int $mapId): void
    {
        $rows = DB::table('map_versions')->where('map_id', $mapId)
            ->orderByDesc('id')->get(['id', 'reason', 'created_at', 'storage_key']);
        if ($rows->count() <= self::KEEP_MIN) {
            return;
        }

        $now = time();
        $keep = [];
        $buckets = [];
        $rank = 0;

        foreach ($rows as $r) {
            $rank++;
            $at = strtotime((string) $r->created_at);
            $age = $now - $at;

            if ($rank <= self::KEEP_MIN || $r->reason === self::MANUAL || $age <= self::KEEP_ALL) {
                $keep[$r->id] = true;

                continue;
            }
            if ($age <= self::KEEP_HOURLY) {
                $bucket = 'h'.intdiv($at, 3600);
            } elseif ($age <= self::KEEP_DAILY) {
                $bucket = 'd'.intdiv($at, 86400);
            } else {
                continue;
            }
            if (! isset($buckets[$bucket])) {
                $buckets[$bucket] = true;
                $keep[$r->id] = true;
            }
        }

        $kept = 0;
        $drop = [];
        foreach ($rows as $r) {
            if (isset($keep[$r->id]) && ++$kept <= self::MAX_PER_MAP) {
                continue;
            }
            $drop[] = $r;
        }

        self::forget($mapId, $drop);
    }

    public static function forget(int $mapId, ?iterable $rows = null): void
    {
        if ($rows === null) {
            self::disk()->deleteDirectory("snapshots/$mapId");
            DB::table('map_versions')->where('map_id', $mapId)->delete();

            return;
        }

        $ids = [];
        $paths = [];
        foreach ($rows as $r) {
            $ids[] = $r->id;
            $paths[] = self::path($mapId, $r->storage_key);
        }
        if (! $ids) {
            return;
        }

        self::disk()->delete($paths);
        DB::table('map_versions')->whereIn('id', $ids)->delete();
    }
}
