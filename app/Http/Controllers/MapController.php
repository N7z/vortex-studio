<?php

namespace App\Http\Controllers;

use App\Support\MapAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class MapController extends Controller
{
    public const TTL_HOURS = 24;

    // A part measures ~115 bytes with its id, so this is MAX_PARTS with headroom
    // for groups. Raising one without the other silently caps the map at the lower.
    private const MAX_BYTES = 8_000_000;

    private const MAX_MAPS_PER_OWNER = 50;

    private const MAX_MAPS_PER_TEAM = 200;

    private const MAX_PARTS = 60_000;

    private const MAX_GROUPS = 2_000;

    /** The example files are named by the world id the game uses; these are shown instead. */
    private const EXAMPLE_TITLES = [
        '1' => 'Demo',
        '3' => 'Snowy Peak',
        '4' => 'The Crossbridges',
        '5' => 'Oasis',
        '6' => 'Pirate Ship Island',
        '7' => 'Vortex HQ',
        '8' => 'Vortexia',
        '9' => 'Familiar Pizzeria',
        '10' => 'Anixus Pond',
        '11' => 'Banlands',
        '13' => 'Classic House',
        '14' => 'Backrooms',
    ];

    /** Keys the editor writes / the example maps use; anything else is rejected. */
    private const PART_KEYS = ['_id', 'T', 'P', 'S', 'R', 'C', 'Tr', 'Shape', 'Sh', 'ItemId'];

    /**
     * An admin is trusted with maps of any size. The request still has to fit PHP's
     * own post_max_size, which is the ceiling nothing here can lift.
     */
    private const MAX_THUMB_BYTES = 300_000;

    private static function thumbDisk()
    {
        return Storage::disk(config('filesystems.thumbs', 'public'));
    }

    private static function thumbPath(string $key): string
    {
        return "thumbs/$key.webp";
    }

    /**
     * A bucket serves the file itself; a plain local disk has no public URL, so the
     * app streams it instead. Both are cache-busted by when it was written.
     */
    private static function thumbUrl(?object $row): ?string
    {
        if (! $row?->thumb_key) {
            return null;
        }

        // A bucket addresses itself, so its own URL is the right one. A local disk
        // would build one from APP_URL, which breaks the moment the port differs, so
        // the app serves those from a path relative to whatever host is being used.
        $name = config('filesystems.thumbs', 'public');
        if (config("filesystems.disks.$name.driver") !== 'local') {
            try {
                return self::thumbDisk()->url(self::thumbPath($row->thumb_key));
            } catch (\Throwable) {
                // No public URL, so fall through to serving it here.
            }
        }

        return "/api/thumbs/{$row->thumb_key}.webp";
    }

    public function exampleThumb(string $name)
    {
        $name = $this->validName($name);
        $path = "thumbs/examples/$name.webp";
        $disk = self::thumbDisk();
        abort_unless($disk->exists($path), 404);

        return response($disk->get($path), 200, [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }

    public function thumb(string $key)
    {
        abort_unless(preg_match('/^[a-f0-9]{32}$/', $key), 404);

        $disk = self::thumbDisk();
        $path = self::thumbPath($key);
        abort_unless($disk->exists($path), 404);

        return response($disk->get($path), 200, [
            'Content-Type' => 'image/webp',
            // The name changes whenever the picture does, so this never goes stale.
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
        // Trust the bytes, not the header: this is written to storage and served back.
        abort_unless(
            str_starts_with($body, 'RIFF') && substr($body, 8, 4) === 'WEBP',
            400,
            'thumbnail must be a webp',
        );

        $disk = self::thumbDisk();
        // A new name every time, so a cached URL can never show a stale picture and
        // the old file does not linger.
        $key = bin2hex(random_bytes(16));
        $disk->put(self::thumbPath($key), $body, 'public');
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

    /** The team a request is scoped to, or null for the caller's personal maps. */
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

    /** Only anonymous maps expire; an account's maps are kept. */
    public static function prune(): void
    {
        DB::table('maps')
            ->whereNull('user_id')
            ->whereNull('team_id')
            ->where('updated_at', '<', now()->subHours(self::TTL_HOURS))
            ->delete();
    }

    private function validName(string $name): string
    {
        abort_unless(preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $name), 400, 'bad map name');

        return $name;
    }

    private function examplesDir(): string
    {
        return resource_path('maps');
    }

    public function stats()
    {
        return response()->json(Cache::remember('studio_stats', 60, function () {
            self::prune();

            // Never select `data`: a map is megabytes and there is no bound on rows.
            $agg = DB::table('maps')->selectRaw(
                'count(*) as maps, count(distinct token) as sessions, coalesce(sum(parts), 0) as parts, max(updated_at) as last_save',
            )->first();
            $last = $agg->last_save;

            return [
                'maps' => (int) $agg->maps,
                'sessions' => (int) $agg->sessions,
                'accounts' => DB::table('users')->count(),
                'parts' => (int) $agg->parts,
                'examples' => count(glob($this->examplesDir().DIRECTORY_SEPARATOR.'*.json')),
                'last_save' => $last ? strtotime($last) : null,
            ];
        }));
    }

    public function index(Request $request)
    {
        self::prune();

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

        $disk = self::thumbDisk();
        $remote = config('filesystems.disks.'.config('filesystems.thumbs', 'public').'.driver') !== 'local';
        $examples = collect(glob($this->examplesDir().DIRECTORY_SEPARATOR.'*.json'))
            ->map(function ($f) use ($disk, $remote) {
                $name = basename($f, '.json');
                $path = "thumbs/examples/$name.webp";

                return [
                    'name' => $name,
                    'title' => self::EXAMPLE_TITLES[$name] ?? $name,
                    'thumb' => $disk->exists($path)
                        ? ($remote ? $disk->url($path) : "/api/thumbs/examples/$name.webp")
                        : null,
                ];
            })
            ->values();

        return response()->json([
            'mine' => $mine,
            'examples' => $examples,
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

        $row = MapAccess::find($request, $name, $this->teamId($request));
        if ($row) {
            return $this->document($row->data, $row->groups, (int) $row->version);
        }

        $file = $this->examplesDir().DIRECTORY_SEPARATOR.$name.'.json';
        abort_unless(is_file($file), 404);

        return $this->document(file_get_contents($file), null, 0);
    }

    public function move(Request $request, string $name)
    {
        $name = $this->validName($name);
        $id = Auth::id();
        abort_unless($id, 401, 'sign in first');

        $from = $this->teamId($request);

        // Rename travels on the same request: both are "where does this map live".
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

        // Taking a map out of a team removes it from everyone else in that team.
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

        return response()->json(['ok' => true, 'name' => $to]);
    }

    public function destroy(Request $request, string $name)
    {
        $name = $this->validName($name);
        $team = $this->teamId($request);
        $row = MapAccess::find($request, $name, $team);
        abort_unless($row, 404);
        abort_unless(MapAccess::canEdit($row), 403, 'you can only view this map');

        // Deleting a team map takes it from everyone in the team.
        if ($team !== null) {
            abort_unless(
                MapAccess::teamRole($team) === MapAccess::OWNER,
                403,
                'only the team owner can delete a team map',
            );
        }

        if ($row->thumb_key) {
            self::thumbDisk()->delete(self::thumbPath($row->thumb_key));
        }
        DB::table('maps')->where('id', $row->id)->delete();

        return response()->json(['ok' => true]);
    }

    /** Parts and groups travel together, so the stored JSON is wrapped rather than re-encoded. */
    private function document(string $parts, ?string $groups, int $version)
    {
        return response('{"parts":'.$parts.',"groups":'.($groups ?: '[]').',"version":'.$version.'}')
            ->header('Content-Type', 'application/json');
    }

    public function save(Request $request, string $name)
    {
        $name = $this->validName($name);
        $body = $request->json()->all();
        abort_unless(is_array($body), 400, 'body must be a JSON array of parts');

        // The bare list is the old shape. Its groups are null, meaning "leave the
        // stored groups alone", so a tab open across a deploy cannot wipe them.
        if (array_is_list($body)) {
            $parts = $body;
            $groups = null;
        } else {
            $parts = $body['parts'] ?? null;
            $groups = $body['groups'] ?? null;
            abort_unless(is_array($parts) && array_is_list($parts), 400, 'body must be a JSON array of parts');
            abort_unless($groups === null || is_array($groups) && array_is_list($groups), 400, 'bad group data');
        }

        abort_unless($this->validParts($parts), 400, 'bad part data');
        abort_unless($groups === null || $this->validGroups($groups, $parts), 400, 'bad group data');

        $data = json_encode($parts);
        $encodedGroups = $groups === null ? null : json_encode($groups);
        abort_if(
            ! self::unlimited() && strlen($data) + strlen((string) $encodedGroups) > self::MAX_BYTES,
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

        $values = ['token' => $token, 'data' => $data, 'parts' => count($parts), 'updated_at' => now()]
            + ($encodedGroups === null ? [] : ['groups' => $encodedGroups]);

        if (! $row) {
            DB::table('maps')->insert($values + [
                'user_id' => $id, 'team_id' => $teamId, 'name' => $name,
                'version' => 1, 'created_at' => now(),
            ]);

            return response()->json(['ok' => true, 'version' => 1]);
        }

        // Optimistic concurrency: a save built on an older copy is refused rather
        // than silently overwriting whoever saved in between. A client that sends
        // no version is trusted, which is what keeps the single-editor case simple.
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

        return response()->json(['ok' => true, 'version' => $next]);
    }

    /**
     * Groups reference parts by `_id`. A group naming a part that is not in the
     * same body would be dead on arrival, and a part in two groups contradicts
     * the editor's own invariant, so both are rejected rather than repaired.
     */
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
        foreach ($groups as $g) {
            if (! is_array($g) || array_diff_key($g, array_flip(['id', 'name', 'ids']))) {
                return false;
            }
            foreach (['id', 'name'] as $k) {
                if (! is_string($g[$k] ?? null) || $g[$k] === '' || strlen($g[$k]) > 64) {
                    return false;
                }
            }
            $ids = $g['ids'] ?? null;
            if (! is_array($ids) || ! array_is_list($ids) || ! $ids) {
                return false;
            }
            foreach ($ids as $id) {
                if (! is_string($id) || ! isset($known[$id]) || isset($taken[$id])) {
                    return false;
                }
                $taken[$id] = true;
            }
        }

        return true;
    }

    /**
     * Light shape check: parts only need to look like what the editor produces.
     * Guards against garbage rows counting toward stats and against any future
     * feature that shares maps between users inheriting unvetted data.
     */
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
            // Optional, so example maps and older clients still validate. When present
            // it must be unique: groups reference parts by it, and a duplicate would
            // point one group entry at two parts.
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
        }

        return true;
    }
}
