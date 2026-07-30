<?php

use App\Http\Controllers\MapController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('studio'));
Route::get('/api/stats', [MapController::class, 'stats'])->middleware('throttle:30,1');

Route::middleware('throttle:60,1')->group(function () {
    Route::get('/api/maps', [MapController::class, 'index']);
    Route::get('/api/maps/{name}', [MapController::class, 'show']);
    Route::put('/api/maps/{name}', [MapController::class, 'save']);
});
