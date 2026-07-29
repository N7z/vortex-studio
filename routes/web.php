<?php

use App\Http\Controllers\MapController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('studio'));
Route::get('/stats', [MapController::class, 'stats']);

Route::get('/api/maps', [MapController::class, 'index']);
Route::get('/api/maps/{name}', [MapController::class, 'show']);
Route::put('/api/maps/{name}', [MapController::class, 'save']);
