<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\MapController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('studio'));

// Deliberately not under /api, which is exempt from CSRF verification.
Route::prefix('account')->group(function () {
    Route::get('/', [AccountController::class, 'me']);
    Route::get('/live-token', [AccountController::class, 'liveToken']);
    Route::post('/register', [AccountController::class, 'register'])->middleware('throttle:5,10');
    Route::post('/login', [AccountController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/logout', [AccountController::class, 'logout']);
});
Route::get('/api/stats', [MapController::class, 'stats'])->middleware('throttle:30,1');

Route::middleware('throttle:60,1')->group(function () {
    Route::get('/api/maps', [MapController::class, 'index']);
    Route::get('/api/maps/{name}', [MapController::class, 'show']);
    Route::put('/api/maps/{name}', [MapController::class, 'save']);
});
