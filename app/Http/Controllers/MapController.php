<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\Cached;
use App\Support\MapAccess;
use App\Support\MapHistory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class MapController extends Controller
{
    public const TTL_HOURS = 24;

    public const TRASH_DAYS = 30;

    private const DESTRUCTIVE_MIN_PARTS = 100;

    private const DESTRUCTIVE_RATIO = 0.5;

    private const MAX_BYTES = 8_000_000;

    private const MAX_MAPS_PER_OWNER = 50;

    private const MAX_MAPS_PER_TEAM = 200;

    private const MAX_PARTS = 60_000;

    private const MAX_GROUPS = 2_000;

    private const MAX_LIGHTS = 32;

    private const PART_KEYS = [
        '_id', 'T', 'P', 'S', 'R', 'C', 'Tr', 'Shape', 'Sh', 'ItemId',
        'M', 'Cs', 'An', 'Cc', 'Bp', 'Tx', 'point_light', 'spot_light', 'N',
    ];

    private const MATERIALS = ['Plastic', 'Wood', 'Metal', 'Grass', 'Ice', 'Paint'];

    private const FACES = ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'];

    private const TEXTURES = ['Studs', 'Inlets'];

    private const LIGHT_KEYS = ['_id', 'N', 'P', 'R', 'C', 'I', 'Sd'];

    private const LIGHTING_KEYS = [
        'ambient_color', 'brightness', 'sun_color', 'sun_illuminance', 'sun_shadow_maps_enabled',
        'sun_rotation',
    ];

    private const MAX_BRIGHTNESS = 20_000;

    private const POINT_LIGHT_KEYS = ['color', 'intensity', 'range', 'shadow_maps_enabled'];

    private const SPOT_LIGHT_KEYS = [...self::POINT_LIGHT_KEYS, 'angle', 'face'];

    private const MAX_INTENSITY = 10_000_000;

    private const MAX_RANGE = 2_000;

    private const MAX_ILLUMINANCE = 200_000;

    private const MAX_THUMB_BYTES = 300_000;

    private static function thumbDisk()
    {
        return Storage::disk();
    }

    private static function thumbsAreRemote(): bool
    {
        return config('filesystems.disks.'.config('filesystems.default').'.driver') !== 'local';
    }

    private static function thumbPath(string $key): string
    {
        return "thumbs/$key.webp";
    }

    private static function thumbUrl(?object $row): ?string
    {
        if (! $row?->thumb_key) {
            return null;
        }

        if (self::thumbsAreRemote()) {
            try {
                return self::thumbDisk()->url(self::thumbPath($row->thumb_key));
            } catch (\Throwable) {
            }
        }

        return "/api/thumbs/{$row->thumb_key}.webp";
    }

    public function thumb(string $key)
    {
        abort_unless(preg_match('/^[a-f0-9]{32}$/', $key), 404);

        $disk = self::thumbDisk();
        $path = self::thumbPath($key);
        abort_unless($disk->exists($path), 404);

        return response($disk->get($path), 200, [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ]);
    }

    public function putThumb(Request $request, string $name)
    {
        $name = $this->validName($name);
        $row = MapAccess::find($request, $name, $this->teamId($request));
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');

        $body = $request->getContent();
        abort_unless(is_string($body) && $body !== '', 400, 'no image');
        abort_if(strlen($body) > self::MAX_THUMB_BYTES, 413, 'thumbnail too large');
        // trust the bytes, not the header: this is written to storage and served back.
        abort_unless(
            str_starts_with($body, 'RIFF') && substr($body, 8, 4) === 'WEBP',
            400,
            'thumbnail must be a webp',
        );

        $disk = self::thumbDisk();
        $key = bin2hex(random_bytes(16));
        if (! $disk->put(self::thumbPath($key), $body)) {
            Log::warning('thumbnail write failed', ['disk' => config('filesystems.default'), 'map' => $row->id]);

            abort(500, 'the thumbnail could not be stored');
        }
        if ($row->thumb_key) {
            $disk->delete(self::thumbPath($row->thumb_key));
        }
        DB::table('maps')->where('id', $row->id)->update(['thumb_key' => $key, 'thumb_at' => now()]);

        return response()->json(['ok' => true]);
    }

    private static function unlimited(): bool
    {
        return (bool) Auth::user()?->is_admin;
    }

    private function token(Request $request): string
    {
        return MapAccess::token($request);
    }

    private function teamId(Request $request): ?int
    {
        $raw = $request->query('team', $request->json('team_id'));
        if ($raw === null || $raw === '') {
            return null;
        }
        abort_unless(is_numeric($raw), 400, 'bad team');
        $id = (int) $raw;
        abort_unless(MapAccess::teamRole($id) !== null, 404);

        return $id;
    }

    public static function prune(): void
    {
        DB::table('maps')
            ->whereNull('user_id')
            ->whereNull('team_id')
            ->whereNull('deleted_at')
            ->where('updated_at', '<', now()->subHours(self::TTL_HOURS))
            ->update(['deleted_at' => now()]);
    }

    public static function purge(): int
    {
        $rows = DB::table('maps')
            ->whereNotNull('deleted_at')
            ->where('deleted_at', '<', now()->subDays(self::TRASH_DAYS))
            ->get(['id', 'thumb_key']);

        foreach ($rows as $row) {
            MapHistory::forget((int) $row->id);
            if ($row->thumb_key) {
                self::thumbDisk()->delete(self::thumbPath($row->thumb_key));
            }
            DB::table('maps')->where('id', $row->id)->delete();
        }

        return $rows->count();
    }

    private function validName(string $name): string
    {
        abort_unless(preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $name), 400, 'bad map name');

        return $name;
    }

    public function stats()
    {
        return response()->json(Cached::remember('studio_stats', 60, function () {
            // never select `data`: a map is megabytes and there is no bound on rows.
            $agg = DB::table('maps')->selectRaw(
                'count(*) as maps, count(distinct token) as sessions, coalesce(sum(parts), 0) as parts, max(updated_at) as last_save',
            )->first();
            $last = $agg->last_save;

            return [
                'maps' => (int) $agg->maps,
                'sessions' => (int) $agg->sessions,
                'accounts' => DB::table('users')->count(),
                'parts' => (int) $agg->parts,
                'last_save' => $last ? strtotime($last) : null,
            ];
        }));
    }

    public function index(Request $request)
    {
        $mine = MapAccess::visible($request)
            ->orderByDesc('updated_at')
            ->get(['id', 'name', 'updated_at', 'team_id', 'version', 'thumb_key'])
            ->map(fn ($m) => [
                'name' => $m->name,
                'modified' => strtotime($m->updated_at),
                'team_id' => $m->team_id,
                'version' => (int) $m->version,
                'thumb' => self::thumbUrl($m),
            ]);

        return response()->json([
            'mine' => $mine,
            'teams' => $this->myTeams(),
            'ttl_hours' => self::TTL_HOURS,
            'account' => AccountController::current(),
        ]);
    }

    private function myTeams(): array
    {
        if (! Auth::id()) {
            return [];
        }

        return DB::table('team_members')
            ->join('teams', 'teams.id', '=', 'team_members.team_id')
            ->where('team_members.user_id', Auth::id())
            ->orderBy('teams.name')
            ->get(['teams.id', 'teams.name', 'team_members.role'])
            ->map(fn ($t) => ['id' => $t->id, 'name' => $t->name, 'role' => $t->role])
            ->all();
    }

    public function show(Request $request, string $name)
    {
        $name = $this->validName($name);

        $row = MapAccess::find($request, $name, $this->teamId($request), true);
        abort_unless($row, 404);

        return $this->document($row->data, $row->groups, $row->lights, $row->project_id, (int) $row->version);
    }

    public function move(Request $request, string $name)
    {
        $name = $this->validName($name);
        $id = Auth::id();
        abort_unless($id, 401, 'sign in first');

        $from = $this->teamId($request);

        $rename = $request->json('to_name');
        if ($rename !== null) {
            return $this->rename($request, $name, $from, (string) $rename);
        }

        $raw = $request->json('to_team');
        $to = $raw === null || $raw === '' ? null : (int) $raw;
        abort_if($to !== null && ! is_numeric($raw), 400, 'bad team');
        abort_if($to === $from, 422, 'it is already there');

        $row = MapAccess::find($request, $name, $from);
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');

        if ($from !== null) {
            abort_unless(MapAccess::teamRole($from) === MapAccess::OWNER, 403, 'only the team owner can move a map out');
        }
        if ($to !== null) {
            $role = MapAccess::teamRole($to);
            abort_unless($role !== null, 404);
            abort_if($role === MapAccess::VIEWER, 403, 'you can only view that team');
        }

        abort_if(
            MapAccess::find($request, $name, $to) !== null,
            422,
            'a map called that is already there, rename one of them first',
        );

        $count = $to === null
            ? MapAccess::personal($request)->count()
            : DB::table('maps')->where('team_id', $to)->count();
        abort_if($count >= ($to === null ? self::MAX_MAPS_PER_OWNER : self::MAX_MAPS_PER_TEAM), 403, 'map limit reached');

        DB::table('maps')->where('id', $row->id)->update([
            'team_id' => $to,
            'user_id' => $to === null ? $id : $row->user_id,
            'updated_at' => now(),
        ]);
        Audit::log('map.move', (int) $row->id, ['name' => $name, 'from' => $from, 'to' => $to], $from ?? $to);

        return response()->json(['ok' => true, 'team_id' => $to]);
    }

    private function rename(Request $request, string $name, ?int $team, string $to)
    {
        $to = $this->validName($to);
        $row = MapAccess::find($request, $name, $team);
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');
        abort_if($to === $name, 422, 'that is already its name');
        abort_if(
            MapAccess::find($request, $to, $team) !== null,
            422,
            'a map called that is already here',
        );

        DB::table('maps')->where('id', $row->id)->update(['name' => $to, 'updated_at' => now()]);
        Audit::log('map.rename', (int) $row->id, ['from' => $name, 'to' => $to], $team);

        return response()->json(['ok' => true, 'name' => $to]);
    }

    public function destroy(Request $request, string $name)
    {
        $name = $this->validName($name);
        $team = $this->teamId($request);
        $row = MapAccess::find($request, $name, $team);
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');

        if ($team !== null) {
            abort_unless(
                MapAccess::teamRole($team) === MapAccess::OWNER,
                403,
                'only the team owner can delete a team map',
            );
        }

        MapHistory::snapshot($row, MapHistory::PRE_DELETE);
        DB::table('maps')->where('id', $row->id)->update(['deleted_at' => now()]);
        Audit::log('map.delete', (int) $row->id, ['name' => $name], $team);

        return response()->json(['ok' => true, 'trash_days' => self::TRASH_DAYS]);
    }

    public function trash(Request $request)
    {
        return response()->json([
            'trash' => MapAccess::trashed($request)
                ->orderByDesc('deleted_at')
                ->limit(200)
                ->get(['id', 'name', 'parts', 'team_id', 'deleted_at', 'updated_at', 'thumb_key'])
                ->map(fn ($m) => [
                    'id' => (int) $m->id,
                    'name' => $m->name,
                    'parts' => (int) $m->parts,
                    'team_id' => $m->team_id,
                    'deleted' => strtotime((string) $m->deleted_at),
                    'modified' => strtotime((string) $m->updated_at),
                    'thumb' => self::thumbUrl($m),
                ]),
            'trash_days' => self::TRASH_DAYS,
        ]);
    }

    private function trashedMap(Request $request, int $id): object
    {
        $row = MapAccess::trashed($request)->where('id', $id)->first(MapAccess::COLUMNS);
        abort_unless($row, 404);

        return $row;
    }

    public function restore(Request $request, int $id)
    {
        $row = $this->trashedMap($request, $id);

        $team = $row->team_id === null ? null : (int) $row->team_id;
        $count = $team === null
            ? MapAccess::personal($request)->count()
            : DB::table('maps')->whereNull('deleted_at')->where('team_id', $team)->count();
        abort_if(
            $count >= ($team === null ? self::MAX_MAPS_PER_OWNER : self::MAX_MAPS_PER_TEAM),
            403,
            'there is no room for it, delete something first',
        );

        $name = $row->name;
        for ($n = 2; MapAccess::find($request, $name, $team) !== null; $n++) {
            abort_if($n > 99, 422, 'rename the map that took its name first');
            $name = substr($row->name, 0, 60)."-$n";
        }

        DB::table('maps')->where('id', $row->id)
            ->update(['deleted_at' => null, 'name' => $name, 'updated_at' => now()]);
        Audit::log('map.restore', (int) $row->id, ['name' => $name], $team);

        return response()->json(['ok' => true, 'name' => $name, 'team_id' => $team]);
    }

    public function purgeOne(Request $request, int $id)
    {
        $row = $this->trashedMap($request, $id);

        MapHistory::forget((int) $row->id);
        if ($row->thumb_key) {
            self::thumbDisk()->delete(self::thumbPath($row->thumb_key));
        }
        DB::table('maps')->where('id', $row->id)->delete();
        Audit::log('map.purge', (int) $row->id, ['name' => $row->name], $row->team_id);

        return response()->json(['ok' => true]);
    }

    public function history(Request $request, string $name)
    {
        $name = $this->validName($name);
        $row = MapAccess::find($request, $name, $this->teamId($request));
        abort_unless($row, 404);

        return response()->json([
            'versions' => MapHistory::versions((int) $row->id),
            'current' => ['version' => (int) $row->version, 'parts' => (int) $row->parts],
        ]);
    }

    public function showVersion(Request $request, string $name, int $versionId)
    {
        $name = $this->validName($name);
        $row = MapAccess::find($request, $name, $this->teamId($request));
        abort_unless($row, 404);

        $doc = MapHistory::document((int) $row->id, $versionId);
        abort_unless($doc, 404, 'that version is no longer stored');

        return response()->json([
            'parts' => $doc['parts'],
            'groups' => $doc['groups'] ?? [],
        ]);
    }

    public function restoreVersion(Request $request, string $name, int $versionId)
    {
        $name = $this->validName($name);
        $team = $this->teamId($request);
        $row = MapAccess::find($request, $name, $team);
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');

        $doc = MapHistory::document((int) $row->id, $versionId);
        abort_unless($doc, 404, 'that version is no longer stored');

        MapHistory::snapshot($row, MapHistory::PRE_RESTORE);

        $next = (int) $row->version + 1;
        $data = json_encode($doc['parts']);
        DB::table('maps')->where('id', $row->id)->update([
            'data' => $data,
            'groups' => json_encode($doc['groups'] ?? []),
            'parts' => count($doc['parts']),
            'bytes' => strlen($data),
            'version' => $next,
            'saved_by' => Auth::id(),
            'updated_at' => now(),
        ]);
        Audit::log('map.version_restore', (int) $row->id, ['name' => $name, 'from' => $versionId], $team);

        return response()->json(['ok' => true, 'version' => $next, 'parts' => count($doc['parts'])]);
    }

    public function pinVersion(Request $request, string $name)
    {
        $name = $this->validName($name);
        $team = $this->teamId($request);
        $row = MapAccess::find($request, $name, $team);
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');

        $id = MapHistory::snapshot($row, MapHistory::MANUAL);
        abort_unless($id, 422, 'there is nothing to keep yet');
        Audit::log('map.pin', (int) $row->id, ['name' => $name, 'version' => (int) $row->version], $team);

        return response()->json(['ok' => true, 'id' => $id]);
    }

    private function document(string $parts, ?string $groups, ?string $lights, ?string $projectId, int $version)
    {
        return response(
            '{"parts":'.$parts
            .',"groups":'.($groups ?: '[]')
            .',"lighting":'.($lights ?: 'null')
            .',"project_id":'.json_encode($projectId)
            .',"version":'.$version.'}',
        )->header('Content-Type', 'application/json');
    }

    private function body(Request $request): mixed
    {
        $raw = $request->getContent();

        if (strtolower((string) $request->header('X-Body-Encoding')) === 'gzip') {
            $plain = @gzdecode($raw);
            abort_unless(is_string($plain), 400, 'the compressed body could not be read');
            $raw = $plain;
        }

        if ($raw === '' && (int) $request->server('CONTENT_LENGTH') > 0) {
            abort(413, 'the map was too large for the server to accept');
        }

        return json_decode($raw, true);
    }

    public function save(Request $request, string $name)
    {
        $name = $this->validName($name);
        $body = $this->body($request);
        abort_unless(is_array($body), 400, 'body must be a JSON array of parts');

        if (array_is_list($body)) {
            $parts = $body;
            $groups = null;
            $lights = null;
            $projectId = null;
        } else {
            $parts = $body['parts'] ?? null;
            $groups = $body['groups'] ?? null;
            $lights = $body['lighting'] ?? $body['lights'] ?? null;
            $projectId = $body['project_id'] ?? null;
            abort_unless(is_array($parts) && array_is_list($parts), 400, 'body must be a JSON array of parts');
            abort_unless($groups === null || is_array($groups) && array_is_list($groups), 400, 'bad group data');
            abort_unless($lights === null || is_array($lights), 400, 'bad light data');
            abort_unless(
                $projectId === null || is_string($projectId) && preg_match('/^[a-f0-9]{32}$/', $projectId),
                400,
                'bad project id',
            );
        }

        abort_unless($this->validParts($parts), 400, 'bad part data');
        abort_unless($groups === null || $this->validGroups($groups, $parts), 400, 'bad group data');
        abort_unless($lights === null || $this->validLighting($lights), 400, 'bad light data');

        $data = json_encode($parts);
        $encodedGroups = $groups === null ? null : json_encode($groups);
        $encodedLights = $lights === null ? null : json_encode($lights);
        abort_if(
            ! self::unlimited()
                && strlen($data) + strlen((string) $encodedGroups) + strlen((string) $encodedLights) > self::MAX_BYTES,
            413,
            'map too large',
        );

        $token = $this->token($request);
        $id = Auth::id();
        $teamId = $this->teamId($request);
        abort_if($teamId !== null && ! $id, 404);

        $row = MapAccess::find($request, $name, $teamId);
        if ($row && ! MapAccess::canEdit($row)) {
            abort(403, 'you can only view this map');
        }
        if (! $row && $teamId !== null && MapAccess::teamRole($teamId) === MapAccess::VIEWER) {
            abort(403, 'you can only view this team');
        }

        if (! $row) {
            $count = $teamId === null
                ? MapAccess::personal($request)->count()
                : DB::table('maps')->where('team_id', $teamId)->count();
            $limit = $teamId === null ? self::MAX_MAPS_PER_OWNER : self::MAX_MAPS_PER_TEAM;
            abort_if($count >= $limit, 403, 'map limit reached');
        }

        $values = [
            'token' => $token, 'data' => $data, 'parts' => count($parts),
            'bytes' => strlen($data), 'saved_by' => $id, 'updated_at' => now(),
        ]
            + ($encodedGroups === null ? [] : ['groups' => $encodedGroups])
            + ($encodedLights === null ? [] : ['lights' => $encodedLights])
            + ($projectId === null ? [] : ['project_id' => $projectId]);

        if (! $row) {
            $new = DB::table('maps')->insertGetId($values + [
                'user_id' => $id, 'team_id' => $teamId, 'name' => $name,
                'version' => 1, 'created_at' => now(),
            ]);
            Audit::log('map.create', $new, ['name' => $name, 'parts' => count($parts)], $teamId);

            return response()->json(['ok' => true, 'version' => 1]);
        }

        $wrecking = $this->destructive($row, count($parts));
        if ($wrecking && ! $request->header('X-Confirm-Destructive')) {
            return response()->json([
                'error' => 'destructive',
                'message' => 'this save removes most of the map',
                'was' => (int) $row->parts,
                'now' => count($parts),
            ], 422);
        }

        MapHistory::snapshot(
            $row,
            $wrecking ? MapHistory::DESTRUCTIVE : MapHistory::SAVE,
            count($parts),
        );

        $sent = $request->json('version');
        $next = (int) $row->version + 1;
        $q = DB::table('maps')->where('id', $row->id);
        if (is_numeric($sent)) {
            $q->where('version', (int) $sent);
        }

        if (! $q->update($values + ['version' => $next])) {
            return response()->json([
                'error' => 'stale',
                'message' => 'someone else saved this map',
                'version' => (int) DB::table('maps')->where('id', $row->id)->value('version'),
            ], 409);
        }

        if ($wrecking) {
            Audit::log(
                'map.save_destructive',
                (int) $row->id,
                ['name' => $name, 'was' => (int) $row->parts, 'now' => count($parts)],
                $teamId,
            );
        }

        return response()->json(['ok' => true, 'version' => $next]);
    }

    private function destructive(object $row, int $incoming): bool
    {
        return $row->team_id !== null
            && (int) $row->parts >= self::DESTRUCTIVE_MIN_PARTS
            && $incoming < (int) $row->parts * self::DESTRUCTIVE_RATIO;
    }

    private function validGroups(array $groups, array $parts): bool
    {
        if (count($groups) > self::MAX_GROUPS) {
            return false;
        }

        $known = [];
        foreach ($parts as $p) {
            if (isset($p['_id'])) {
                $known[$p['_id']] = true;
            }
        }

        $taken = [];
        $seen = [];
        $parents = [];
        foreach ($groups as $g) {
            if (! is_array($g) || array_diff_key($g, array_flip(['id', 'name', 'ids', 'parent']))) {
                return false;
            }
            foreach (['id', 'name'] as $k) {
                if (! is_string($g[$k] ?? null) || $g[$k] === '' || strlen($g[$k]) > 64) {
                    return false;
                }
            }
            if (isset($seen[$g['id']])) {
                return false;
            }
            $seen[$g['id']] = true;
            $ids = $g['ids'] ?? null;
            // A folder holding nothing but other folders has no parts of its own.
            if (! is_array($ids) || ! array_is_list($ids)) {
                return false;
            }
            foreach ($ids as $id) {
                if (! is_string($id) || ! isset($known[$id]) || isset($taken[$id])) {
                    return false;
                }
                $taken[$id] = true;
            }
            $parent = $g['parent'] ?? null;
            if ($parent !== null) {
                if (! is_string($parent) || $parent === $g['id'] || strlen($parent) > 64) {
                    return false;
                }
                $parents[$g['id']] = $parent;
            }
        }

        foreach ($parents as $id => $parent) {
            if (! isset($seen[$parent])) {
                return false;
            }
            // Walking up has to reach the top rather than come back round.
            $at = $parent;
            for ($hops = 0; $at !== null && $hops <= count($groups); $hops++) {
                if ($at === $id) {
                    return false;
                }
                $at = $parents[$at] ?? null;
            }
        }

        return true;
    }

    private function validParts(array $parts): bool
    {
        if (! self::unlimited() && count($parts) > self::MAX_PARTS) {
            return false;
        }

        $ids = [];
        foreach ($parts as $p) {
            if (! is_array($p) || array_diff_key($p, array_flip(self::PART_KEYS))) {
                return false;
            }
            if (array_key_exists('_id', $p)) {
                if (! is_string($p['_id']) || ! preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $p['_id'])) {
                    return false;
                }
                if (isset($ids[$p['_id']])) {
                    return false;
                }
                $ids[$p['_id']] = true;
            }
            if (! is_string($p['T'] ?? null) || strlen($p['T']) > 32) {
                return false;
            }
            foreach (['P', 'S', 'R'] as $k) {
                $v = $p[$k] ?? null;
                if (! is_array($v) || ! array_is_list($v) || count($v) !== 3) {
                    return false;
                }
                foreach ($v as $n) {
                    if (! is_int($n) && ! is_float($n)) {
                        return false;
                    }
                }
            }
            if (isset($p['C']) && (! is_string($p['C']) || ! preg_match('/^[0-9a-fA-F]{0,6}$/', $p['C']))) {
                return false;
            }
            if (isset($p['Tr']) && (! (is_int($p['Tr']) || is_float($p['Tr'])) || $p['Tr'] < 0 || $p['Tr'] > 1)) {
                return false;
            }
            foreach (['Shape', 'Sh'] as $k) {
                if (isset($p[$k]) && (! is_string($p[$k]) || strlen($p[$k]) > 32)) {
                    return false;
                }
            }
            if (array_key_exists('ItemId', $p) && $p['ItemId'] !== null && ! is_int($p['ItemId'])) {
                return false;
            }
            if (isset($p['M']) && ! in_array($p['M'], self::MATERIALS, true)) {
                return false;
            }
            foreach (['Cs', 'An', 'Cc', 'Bp'] as $k) {
                if (array_key_exists($k, $p) && ! is_bool($p[$k])) {
                    return false;
                }
            }
            if (array_key_exists('Tx', $p) && ! $this->validTextures($p['Tx'])) {
                return false;
            }
            if (array_key_exists('N', $p)
                && (! is_string($p['N']) || $p['N'] === '' || strlen($p['N']) > 64)) {
                return false;
            }
            foreach ([['point_light', false], ['spot_light', true]] as [$k, $spot]) {
                $light = $p[$k] ?? null;
                if ($light !== null && ! $this->validPartLight($light, $spot)) {
                    return false;
                }
            }
        }

        return true;
    }

    /** A light carried by the part it shines from. A spot adds a cone and the face it points out of. */
    private function validPartLight(mixed $light, bool $spot): bool
    {
        if (! is_array($light) || array_is_list($light)) {
            return false;
        }
        $allowed = $spot ? self::SPOT_LIGHT_KEYS : self::POINT_LIGHT_KEYS;
        if (array_diff_key($light, array_flip($allowed))) {
            return false;
        }
        if (! is_string($light['color'] ?? null) || ! preg_match('/^[0-9a-fA-F]{6}$/', $light['color'])) {
            return false;
        }
        foreach ([['intensity', self::MAX_INTENSITY], ['range', self::MAX_RANGE]] as [$k, $max]) {
            $v = $light[$k] ?? null;
            if (! is_int($v) && ! is_float($v) || $v < 0 || $v > $max) {
                return false;
            }
        }
        if (! is_bool($light['shadow_maps_enabled'] ?? null)) {
            return false;
        }
        if (! $spot) {
            return true;
        }
        $angle = $light['angle'] ?? null;
        if (! is_int($angle) && ! is_float($angle) || $angle < 1 || $angle > 89) {
            return false;
        }

        return in_array($light['face'] ?? null, self::FACES, true);
    }

    private function validTextures(mixed $tx): bool
    {
        if (! is_array($tx) || array_is_list($tx) && $tx !== []) {
            return false;
        }
        foreach ($tx as $face => $kind) {
            if (! in_array($face, self::FACES, true) || ! in_array($kind, self::TEXTURES, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * The rig is one object now. A map saved before that carries a list of suns, which stays
     * readable so old rows keep loading; the client folds it into the one sun on the way in.
     */
    private function validLighting(array $lighting): bool
    {
        if (array_is_list($lighting)) {
            return $this->validLights($lighting);
        }

        if (array_diff_key($lighting, array_flip(self::LIGHTING_KEYS))) {
            return false;
        }

        foreach (['ambient_color', 'sun_color'] as $k) {
            $v = $lighting[$k] ?? null;
            if ($v !== null && (! is_string($v) || ! preg_match('/^[0-9a-fA-F]{6}$/', $v))) {
                return false;
            }
        }

        foreach ([['brightness', self::MAX_BRIGHTNESS], ['sun_illuminance', self::MAX_ILLUMINANCE]] as [$k, $max]) {
            $v = $lighting[$k] ?? null;
            if ($v !== null && (! is_int($v) && ! is_float($v) || $v < 0 || $v > $max)) {
                return false;
            }
        }

        $shadows = $lighting['sun_shadow_maps_enabled'] ?? null;
        if ($shadows !== null && ! is_bool($shadows)) {
            return false;
        }

        $rotation = $lighting['sun_rotation'] ?? null;
        if ($rotation !== null) {
            if (! is_array($rotation) || ! array_is_list($rotation) || count($rotation) !== 3) {
                return false;
            }
            foreach ($rotation as $n) {
                if (! is_int($n) && ! is_float($n)) {
                    return false;
                }
            }
        }

        return true;
    }

    private function validLights(array $lights): bool
    {
        if (! array_is_list($lights) || count($lights) > self::MAX_LIGHTS) {
            return false;
        }

        $ids = [];
        foreach ($lights as $l) {
            if (! is_array($l) || array_diff_key($l, array_flip(self::LIGHT_KEYS))) {
                return false;
            }
            if (! is_string($l['_id'] ?? null) || ! preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $l['_id'])) {
                return false;
            }
            if (isset($ids[$l['_id']])) {
                return false;
            }
            $ids[$l['_id']] = true;
            if (! is_string($l['N'] ?? null) || $l['N'] === '' || strlen($l['N']) > 64) {
                return false;
            }
            foreach (['P', 'R'] as $k) {
                $v = $l[$k] ?? null;
                if (! is_array($v) || ! array_is_list($v) || count($v) !== 3) {
                    return false;
                }
                foreach ($v as $n) {
                    if (! is_int($n) && ! is_float($n)) {
                        return false;
                    }
                }
            }
            if (! is_string($l['C'] ?? null) || ! preg_match('/^[0-9a-fA-F]{6}$/', $l['C'])) {
                return false;
            }
            $i = $l['I'] ?? null;
            if (! is_int($i) && ! is_float($i) || $i < 0 || $i > self::MAX_ILLUMINANCE) {
                return false;
            }
            if (! is_bool($l['Sd'] ?? null)) {
                return false;
            }
        }

        return true;
    }
}
