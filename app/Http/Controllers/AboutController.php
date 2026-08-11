<?php

namespace App\Http\Controllers;

use App\Support\Cached;
use Illuminate\Support\Facades\Http;

class AboutController extends Controller
{
    private const CONTRIBUTOR_TTL = 21600;

    public function info()
    {
        $deployed = self::deployedAt();

        return response()->json([
            'deployed_at' => $deployed,
            'deploy_uptime' => $deployed ? time() - $deployed : null,
        ]);
    }

    public function contributors()
    {
        $repo = config('services.github.repo');

        if (! $repo) {
            return response()->json(['contributors' => []]);
        }

        return response()->json([
            'contributors' => Cached::remember("about_contributors_$repo", self::CONTRIBUTOR_TTL, function () use ($repo) {
                try {
                    $r = Http::timeout(5)
                        ->withHeaders(['Accept' => 'application/vnd.github+json'])
                        ->get("https://api.github.com/repos/$repo/contributors", ['per_page' => 30]);

                    if (! $r->successful()) {
                        return [];
                    }

                    return collect($r->json())
                        ->filter(fn ($c) => ($c['type'] ?? '') === 'User')
                        ->map(fn ($c) => [
                            'name' => $c['login'],
                            'avatar' => $c['avatar_url'] ?? null,
                            'url' => $c['html_url'] ?? null,
                            'commits' => (int) ($c['contributions'] ?? 0),
                        ])
                        ->values()
                        ->all();
                } catch (\Throwable $e) {
                    return [];
                }
            }),
        ]);
    }

    private static function deployedAt(): ?int
    {
        $manifest = public_path('build/manifest.json');
        $at = is_file($manifest) ? @filemtime($manifest) : false;

        return $at === false ? null : $at;
    }
}
