<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MapController extends Controller
{
    private const TTL_HOURS = 24;
    private const MAX_BYTES = 2_000_000;

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
        DB::table('maps')->where('updated_at', '<', now()->subHours(self::TTL_HOURS))->delete();

        $rows = DB::table('maps')->get(['token', 'data', 'updated_at']);

        return view('stats', [
            'maps' => $rows->count(),
            'sessions' => $rows->pluck('token')->unique()->count(),
            'parts' => $rows->sum(fn ($r) => count(json_decode($r->data) ?: [])),
            'examples' => count(glob($this->examplesDir().DIRECTORY_SEPARATOR.'*.json')),
            'lastSave' => $rows->max('updated_at'),
            'ttl' => self::TTL_HOURS,
        ]);
    }

    public function index(Request $request)
    {
        DB::table('maps')->where('updated_at', '<', now()->subHours(self::TTL_HOURS))->delete();

        $mine = DB::table('maps')
            ->where('token', $this->token($request))
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
        ]);
    }

    public function show(Request $request, string $name)
    {
        $name = $this->validName($name);

        $row = DB::table('maps')
            ->where('token', $this->token($request))
            ->where('name', $name)
            ->first();
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
        abort_unless(is_array($parts), 400, 'body must be a JSON array of parts');

        $data = json_encode($parts);
        abort_if(strlen($data) > self::MAX_BYTES, 413, 'map too large');

        DB::table('maps')->updateOrInsert(
            ['token' => $this->token($request), 'name' => $name],
            ['data' => $data, 'updated_at' => now(), 'created_at' => now()],
        );

        return response()->json(['ok' => true]);
    }
}
