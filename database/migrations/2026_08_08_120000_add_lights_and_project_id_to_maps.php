<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            // Lights travel with the document the way groups already do.
            $table->text('lights')->nullable();
            // The identity the official Studio project keeps across exports. Minted
            // by the editor, so it is null for every map saved before this.
            $table->char('project_id', 32)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('maps', function (Blueprint $table) {
            $table->dropColumn(['lights', 'project_id']);
        });
    }
};
