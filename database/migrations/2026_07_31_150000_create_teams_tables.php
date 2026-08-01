<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teams', function (Blueprint $table) {
            $table->id();
            $table->string('name', 64);
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
        });

        Schema::create('team_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 16)->default('editor');
            $table->timestamps();
            $table->unique(['team_id', 'user_id']);
        });

        Schema::table('maps', function (Blueprint $table) {
            // user_id stays set to the creator: prune() treats a null user_id as
            // anonymous and would delete every team map 24 hours after its last save.
            $table->foreignId('team_id')->nullable()->index();
            $table->unique(['team_id', 'name']);
        });

        // (user_id, name) must only be unique among the creator's *personal* maps,
        // or their own map of that name would block the team's.
        Schema::table('maps', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'name']);
        });
        if ($this->supportsPartialIndex()) {
            DB::statement('create unique index maps_personal_user_name_unique on maps (user_id, name) where team_id is null');
        }
    }

    public function down(): void
    {
        if ($this->supportsPartialIndex()) {
            DB::statement('drop index if exists maps_personal_user_name_unique');
        }
        DB::statement('drop index if exists maps_user_id_name_unique');
        Schema::table('maps', function (Blueprint $table) {
            $table->unique(['user_id', 'name']);
        });

        Schema::table('maps', function (Blueprint $table) {
            $table->dropUnique(['team_id', 'name']);
            $table->dropIndex(['team_id']);
            $table->dropColumn('team_id');
        });

        Schema::dropIfExists('team_members');
        Schema::dropIfExists('teams');
    }

    private function supportsPartialIndex(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['sqlite', 'pgsql'], true);
    }
};
