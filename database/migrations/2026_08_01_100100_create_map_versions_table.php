<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('map_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('map_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('version');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 16)->default('save');
            $table->unsignedInteger('parts')->default(0);
            $table->unsignedInteger('bytes')->default(0);
            $table->char('hash', 64);
            $table->string('storage_key', 128);
            $table->timestamp('created_at')->nullable();

            $table->index(['map_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('map_versions');
    }
};
