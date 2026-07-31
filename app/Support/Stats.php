<?php

namespace App\Support;

use App\Http\Controllers\MapController;
use Illuminate\Support\Facades\DB;

class Stats
{
    /** Current totals. Reads `data` a chunk at a time: a map is up to 2 MB. */
    public static function totals(): array
    {
        $parts = 0;
        DB::table('maps')->orderBy('id')->select(['id', 'data'])->chunk(50, function ($rows) use (&$parts) {
            foreach ($rows as $row) {
                $parts += count(json_decode((string) $row->data, true) ?: []);
            }
        });

        $maps = DB::table('maps')->selectRaw(
            'count(*) as total, count(case when user_id is null then 1 end) as anon, max(updated_at) as last_save',
        )->first();

        return [
            'users' => DB::table('users')->count(),
            'maps' => (int) $maps->total,
            'maps_anon' => (int) $maps->anon,
            'parts' => $parts,
            'last_save' => $maps->last_save ? strtotime($maps->last_save) : null,
        ];
    }

    /**
     * One row per day, written by `stats:snapshot`. Totals have no history in the
     * maps table itself, so a day never recorded stays missing rather than guessed.
     */
    public static function snapshot(): array
    {
        MapController::prune();

        $totals = self::totals();
        unset($totals['last_save']);

        DB::table('daily_stats')->updateOrInsert(
            ['day' => now()->toDateString()],
            $totals + ['updated_at' => now(), 'created_at' => now()],
        );

        return $totals;
    }
}
