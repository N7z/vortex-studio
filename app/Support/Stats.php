<?php

namespace App\Support;

use App\Http\Controllers\MapController;
use Illuminate\Support\Facades\DB;

class Stats
{
    public static function totals(): array
    {
        $maps = DB::table('maps')->selectRaw(
            'count(*) as total, count(case when user_id is null then 1 end) as anon,'
            .' sum(parts) as parts, max(updated_at) as last_save',
        )->first();

        return [
            'users' => DB::table('users')->count(),
            'maps' => (int) $maps->total,
            'maps_anon' => (int) $maps->anon,
            'parts' => (int) $maps->parts,
            'last_save' => $maps->last_save ? strtotime($maps->last_save) : null,
        ];
    }

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
