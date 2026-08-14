<?php

namespace App\Providers;

use Illuminate\Foundation\DevCommands;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        $this->registerDevCommands();
    }

    /**
     * Run the live editing server alongside the rest of the dev stack.
     *
     * It is an optional component with its own dependencies, so it only joins in
     * once those are installed. Otherwise it would crash on boot and take the
     * whole dev stack down with it.
     */
    private function registerDevCommands(): void
    {
        if (! is_dir(base_path('live-editing-server/node_modules'))) {
            return;
        }

        DevCommands::register('node live-editing-server/src/index.js', 'live')->pink();
    }
}
