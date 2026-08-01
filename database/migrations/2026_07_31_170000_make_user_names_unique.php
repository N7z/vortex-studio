<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $seen = [];
        foreach (DB::table('users')->orderBy('id')->get(['id', 'name']) as $user) {
            $key = mb_strtolower($user->name);
            if (! isset($seen[$key])) {
                $seen[$key] = true;

                continue;
            }
            for ($n = 2; $n < 1000; $n++) {
                $candidate = mb_substr($user->name, 0, 28)."-$n";
                if (! isset($seen[mb_strtolower($candidate)])) {
                    DB::table('users')->where('id', $user->id)->update(['name' => $candidate]);
                    $seen[mb_strtolower($candidate)] = true;
                    break;
                }
            }
        }

        DB::statement('create unique index users_name_lower_unique on users (lower(name))');
    }

    public function down(): void
    {
        DB::statement('drop index if exists users_name_lower_unique');
    }
};
