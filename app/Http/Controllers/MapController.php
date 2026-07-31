<?php

namespace App\Http\Controllers;

use Illuminate\Contracts\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MapController extends Controller
{
    public const TTL_HOURS = 24;

    // Raised with persisted part ids: they add ~20 bytes per part, so a full
    // 20k-part map that used to fit would start failing to save.
    private const MAX_BYTES = 2_500_000;

    private const MAX_MAPS_PER_OWNER = 50;

    private const MAX_PARTS = 20_000;

    private const MAX_GROUPS = 2_000;

    /** Keys the editor writes / the example maps use; anything else is rejected. */
    private const PART_KEYS = ['_id', 'T', 'P', 'S', 'R', 'C', 'Tr', 'Shape', 'Sh', 'ItemId'];

    /**
     * Anonymous per-visitor identity: a random cookie, no login.
     * Re-queued on every request so the cookie outlives the map TTL.
     */
    private function token(Request $request): string
    {
        $t = $request->cookie('studio_token');
        if (! is_string($t) || ! preg_match('/^[A-Za-z0-9]{40}$/', $t)) {
            $t = Str::random(40);
        }
        Cookie::queue('studio_token', $t, 60 * 24 * 7);

        return $t;
    }

    /**
     * A signed-in visitor owns maps by account, everyone else by cookie. The cookie
     * is issued either way, so signing out returns them to their anonymous maps.
     */
    private function scope(Request $request): Builder
    {
        $id = Auth::id();
        $token = $this->token($request);

        return $id
            ? DB::table('maps')->where('user_id', $id)
            : DB::table('maps')->whereNull('user_id')->where('token', $token);
    }

    /** Only anonymous maps expire; an account's maps are kept. */
    public static function prune(): void
    {
        DB::table('maps')
            ->whereNull('user_id')
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

            // Never select `data`: a map is up to 2 MB and there is no bound on rows.
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

        $mine = $this->scope($request)
            ->orderByDesc('updated_at')
            ->get(['name', 'updated_at'])
            ->map(fn ($m) => ['name' => $m->name, 'modified' => strtotime($m->updated_at)]);

        $examples = collect(glob($this->examplesDir().DIRECTORY_SEPARATOR.'*.json'))
            ->map(fn ($f) => ['name' => basename($f, '.json')])
            ->values();

        return response()->json([
            'mine' => $mine,
            'examples' => $examples,
            'ttl_hours' => self::TTL_HOURS,
            'account' => AccountController::current(),
        ]);
    }

    public function show(Request $request, string $name)
    {
        $name = $this->validName($name);

        $row = $this->scope($request)->where('name', $name)->first();
        if ($row) {
            return $this->document($row->data, $row->groups);
        }

        $file = $this->examplesDir().DIRECTORY_SEPARATOR.$name.'.json';
        abort_unless(is_file($file), 404);

        return $this->document(file_get_contents($file), null);
    }

    /** Parts and groups travel together, so the stored JSON is wrapped rather than re-encoded. */
    private function document(string $parts, ?string $groups)
    {
        return response('{"parts":'.$parts.',"groups":'.($groups ?: '[]').'}')
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
        abort_if(strlen($data) + strlen((string) $encodedGroups) > self::MAX_BYTES, 413, 'map too large');

        $token = $this->token($request);
        $id = Auth::id();
        $exists = $this->scope($request)->where('name', $name)->exists();
        abort_if(
            ! $exists && $this->scope($request)->count() >= self::MAX_MAPS_PER_OWNER,
            403,
            'map limit reached',
        );

        DB::table('maps')->updateOrInsert(
            $id ? ['user_id' => $id, 'name' => $name] : ['user_id' => null, 'token' => $token, 'name' => $name],
            fn (bool $exists) => ['token' => $token, 'data' => $data, 'parts' => count($parts), 'updated_at' => now()]
                + ($encodedGroups === null ? [] : ['groups' => $encodedGroups])
                + ($exists ? [] : ['created_at' => now()]),
        );

        return response()->json(['ok' => true]);
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
        if (count($parts) > self::MAX_PARTS) {
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
