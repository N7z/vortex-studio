<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * (token, name) must only be unique among anonymous rows: two accounts saving
     * the same name from one browser share a token and collided on insert.
     * MySQL has no partial index, so there the constraint is application-side only.
     */
    public function up(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            $table->dropUnique(['token', 'name']);
        });

        if ($this->supportsPartialIndex()) {
            DB::statement('create unique index maps_anon_token_name_unique on maps (token, name) where user_id is null');
        } else {
            Schema::table('maps', function (Blueprint $table) {
                $table->index(['token', 'name']);
            });
        }
    }

    public function down(): void
    {
        if ($this->supportsPartialIndex()) {
            DB::statement('drop index maps_anon_token_name_unique');
        } else {
            Schema::table('maps', function (Blueprint $table) {
                $table->dropIndex(['token', 'name']);
            });
        }

        Schema::table('maps', function (Blueprint $table) {
            $table->unique(['token', 'name']);
        });
    }

    private function supportsPartialIndex(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['sqlite', 'pgsql'], true);
    }
};
