<?php

namespace App\Support;

use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class Audit
{
    private const MAX_META = 2000;

    public const KEEP_DAYS = 180;

    public const IMAGE_DIR = 'audit-images';

    public static function images(): Filesystem
    {
        return Storage::disk(config('filesystems.audit'));
    }

    public static function purgeOld(): int
    {
        $stale = DB::table('audit_log')
            ->where('created_at', '<', now()->subDays(self::KEEP_DAYS));

        foreach ($stale->clone()->pluck('meta') as $meta) {
            if ($path = self::imageOf($meta)) {
                self::images()->delete($path);
            }
        }

        return $stale->delete();
    }

    public static function imageOf(?string $meta): ?string
    {
        $path = json_decode((string) $meta, true)['image'] ?? null;

        return is_string($path) && str_starts_with($path, self::IMAGE_DIR.'/') ? $path : null;
    }

    public static function log(string $action, ?int $subjectId = null, array $meta = [], ?int $teamId = null): void
    {
        try {
            $json = $meta ? json_encode($meta) : null;
            if ($json !== null && strlen($json) > self::MAX_META) {
                $json = json_encode(array_filter([
                    'truncated' => true,
                    'image' => $meta['image'] ?? null,
                ]));
            }

            DB::table('audit_log')->insert([
                'user_id' => Auth::id(),
                'action' => $action,
                'subject_type' => strtok($action, '.') ?: null,
                'subject_id' => $subjectId,
                'team_id' => $teamId,
                'meta' => $json,
                'ip' => request()?->ip(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('audit write failed', ['action' => $action, 'error' => $e->getMessage()]);
        }
    }
}
