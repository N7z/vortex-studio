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

    private const MAX_BYTES = 2_000_000;

    private const MAX_MAPS_PER_OWNER = 50;

    private const MAX_PARTS = 20_000;

    /** Keys the editor writes / the example maps use; anything else is rejected. */
    private const PART_KEYS = ['T', 'P', 'S', 'R', 'C', 'Tr', 'Shape', 'Sh', 'ItemId'];

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
        // Scanning + decoding every map is too expensive for a public route,
        // so the numbers are recomputed at most once a minute.
        return response()->json(Cache::remember('studio_stats', 60, function () {
            self::prune();

            $rows = DB::table('maps')->get(['token', 'data', 'updated_at']);
            $last = $rows->max('updated_at');

            return [
                'maps' => $rows->count(),
                'sessions' => $rows->pluck('token')->unique()->count(),
                'accounts' => DB::table('users')->count(),
                'parts' => $rows->sum(fn ($r) => count(json_decode($r->data) ?: [])),
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
            return response($row->data)->header('Content-Type', 'application/json');
        }

        $file = $this->examplesDir().DIRECTORY_SEPARATOR.$name.'.json';
        abort_unless(is_file($file), 404);

        return response(file_get_contents($file))->header('Content-Type', 'application/json');
    }

    public function save(Request $request, string $name)
    {
        $name = $this->validName($name);
        $parts = $request->json()->all();
        abort_unless(is_array($parts) && array_is_list($parts), 400, 'body must be a JSON array of parts');
        abort_unless($this->validParts($parts), 400, 'bad part data');

        $data = json_encode($parts);
        abort_if(strlen($data) > self::MAX_BYTES, 413, 'map too large');

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
            ['token' => $token, 'data' => $data, 'updated_at' => now(), 'created_at' => now()],
        );

        return response()->json(['ok' => true]);
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

        foreach ($parts as $p) {
            if (! is_array($p) || array_diff_key($p, array_flip(self::PART_KEYS))) {
                return false;
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
