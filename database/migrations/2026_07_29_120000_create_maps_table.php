<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maps', function (Blueprint $table) {
            $table->id();
            $table->string('token', 64)->index();
            $table->string('name', 64);
            $table->longText('data');
            $table->timestamps();
            $table->unique(['token', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('maps');
    }
};
