<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Duplicates already exist, and the index cannot be added over them.
        $seen = [];
        foreach (DB::table('teams')->orderBy('id')->get(['id', 'owner_id', 'name']) as $team) {
            $key = $team->owner_id.'/'.$team->name;
            if (! isset($seen[$key])) {
                $seen[$key] = true;

                continue;
            }
            for ($n = 2; $n < 100; $n++) {
                $candidate = substr($team->name, 0, 60)." ($n)";
                if (! isset($seen[$team->owner_id.'/'.$candidate])) {
                    DB::table('teams')->where('id', $team->id)->update(['name' => $candidate]);
                    $seen[$team->owner_id.'/'.$candidate] = true;
                    break;
                }
            }
        }

        Schema::table('teams', function (Blueprint $table) {
            $table->unique(['owner_id', 'name']);
        });
    }

    public function down(): void
    {
        Schema::table('teams', function (Blueprint $table) {
            $table->dropUnique(['owner_id', 'name']);
        });
    }
};
