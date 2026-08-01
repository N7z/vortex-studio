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
            $table->timestamp('deleted_at')->nullable()->index();
            $table->foreignId('saved_by')->nullable()->constrained('users')->nullOnDelete();
        });

        DB::table('maps')->whereNull('saved_by')->update(['saved_by' => DB::raw('user_id')]);

        if (! $this->partial()) {
            return;
        }

        DB::statement('drop index if exists maps_anon_token_name_unique');
        DB::statement('create unique index maps_anon_token_name_unique on maps (token, name) where user_id is null and deleted_at is null');

        DB::statement('drop index if exists maps_personal_user_name_unique');
        DB::statement('create unique index maps_personal_user_name_unique on maps (user_id, name) where team_id is null and deleted_at is null');

        Schema::table('maps', function (Blueprint $table) {
            $table->dropUnique(['team_id', 'name']);
        });
        DB::statement('create unique index maps_team_name_unique on maps (team_id, name) where deleted_at is null');
    }

    public function down(): void
    {
        if ($this->partial()) {
            DB::statement('drop index if exists maps_team_name_unique');
            Schema::table('maps', function (Blueprint $table) {
                $table->unique(['team_id', 'name']);
            });

            DB::statement('drop index if exists maps_personal_user_name_unique');
            DB::statement('create unique index maps_personal_user_name_unique on maps (user_id, name) where team_id is null');

            DB::statement('drop index if exists maps_anon_token_name_unique');
            DB::statement('create unique index maps_anon_token_name_unique on maps (token, name) where user_id is null');
        }

        Schema::table('maps', function (Blueprint $table) {
            $table->dropConstrainedForeignId('saved_by');
            $table->dropIndex(['deleted_at']);
            $table->dropColumn('deleted_at');
        });
    }

    private function partial(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['sqlite', 'pgsql'], true);
    }
};
