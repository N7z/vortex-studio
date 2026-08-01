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
            $table->unsignedBigInteger('bytes')->default(0);
        });

        $this->backfillBytes();

        if ($this->partial()) {
            DB::statement(
                'create index maps_anon_ttl_idx on maps (updated_at)'
                .' where user_id is null and team_id is null and deleted_at is null',
            );
            DB::statement('create index maps_user_updated_idx on maps (user_id, updated_at) where deleted_at is null');
            DB::statement('create index maps_team_updated_idx on maps (team_id, updated_at) where deleted_at is null');
        }

        foreach ($this->spentIndexes() as $name) {
            DB::statement("drop index if exists $name");
        }
    }

    public function down(): void
    {
        Schema::table('audit_log', function (Blueprint $table) {
            $table->index('user_id');
            $table->index('action');
            $table->index('team_id');
            $table->index(['subject_type', 'subject_id']);
        });

        if ($this->partial()) {
            foreach (['maps_anon_ttl_idx', 'maps_user_updated_idx', 'maps_team_updated_idx'] as $name) {
                DB::statement("drop index if exists $name");
            }
        }

        Schema::table('maps', function (Blueprint $table) {
            $table->dropColumn('bytes');
        });
    }

    /** Chunked: a row is megabytes and Postgres rewrites each one, so a single
     * statement would hold locks and dead tuples over the whole table. VACUUM after. */
    private function backfillBytes(): void
    {
        $length = $this->byteLength('data');
        $id = 0;

        while (true) {
            $ids = DB::table('maps')->where('id', '>', $id)->orderBy('id')->limit(200)->pluck('id');
            if ($ids->isEmpty()) {
                break;
            }

            DB::statement(
                'update maps set bytes = coalesce('.$length.', 0) where id in ('.$ids->implode(',').')',
            );
            $id = $ids->last();
        }
    }

    private function spentIndexes(): array
    {
        return [
            'audit_log_user_id_index',
            'audit_log_action_index',
            'audit_log_team_id_index',
            'audit_log_subject_type_subject_id_index',
        ];
    }

    private function byteLength(string $column): string
    {
        return DB::connection()->getDriverName() === 'pgsql'
            ? "octet_length($column)"
            : "length($column)";
    }

    private function partial(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['sqlite', 'pgsql'], true);
    }
};
