<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->index();
            // NULLs compare distinct, so this constrains signed-in maps only.
            $table->unique(['user_id', 'name']);
        });
    }

    public function down(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'name']);
            $table->dropIndex(['user_id']);
            $table->dropColumn('user_id');
        });
    }
};
