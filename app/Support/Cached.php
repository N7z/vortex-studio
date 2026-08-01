<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/** The cache is scale-to-zero, so a cold instance is an ordinary event, not a 500. */
class Cached
{
    public static function remember(string $key, int $ttl, callable $make): mixed
    {
        try {
            return Cache::remember($key, $ttl, $make);
        } catch (\Throwable $e) {
            Log::warning('cache unavailable, computing directly', ['key' => $key, 'error' => $e->getMessage()]);

            return $make();
        }
    }

    public static function forget(string $key): void
    {
        try {
            Cache::forget($key);
        } catch (\Throwable $e) {
            Log::warning('cache forget failed', ['key' => $key, 'error' => $e->getMessage()]);
        }
    }
}
