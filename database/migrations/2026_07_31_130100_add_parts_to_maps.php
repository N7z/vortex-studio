<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            $table->unsignedInteger('parts')->default(0);
        });

        // Chunked by id and selecting one data column at a time, so the backfill
        // cannot hold more than one map's JSON at once.
        $id = 0;
        while (true) {
            $rows = DB::table('maps')->where('id', '>', $id)->orderBy('id')->limit(50)->pluck('id');
            if ($rows->isEmpty()) {
                break;
            }
            foreach ($rows as $id) {
                $data = DB::table('maps')->where('id', $id)->value('data');
                DB::table('maps')->where('id', $id)->update(['parts' => count(json_decode((string) $data, true) ?: [])]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            $table->dropColumn('parts');
        });
    }
};
