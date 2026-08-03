<?php

use App\Http\Controllers\MapController;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('stats:snapshot')->dailyAt('23:50')->withoutOverlapping();
Schedule::command('maps:purge')->dailyAt('04:20')->withoutOverlapping();
Schedule::call(fn () => MapController::prune())->twiceDaily(10, 22)->name('maps:prune')->withoutOverlapping();
