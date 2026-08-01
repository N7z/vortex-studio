<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\MapController;
use App\Http\Controllers\TeamController;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;

Route::get('/', fn () => view('studio'));

Route::get('/api/build', fn () => ['build' => Vite::manifestHash()])->middleware('throttle:120,1');

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
    Route::patch('/api/maps/{name}', [MapController::class, 'move']);

    Route::get('/api/teams', [TeamController::class, 'index']);
    Route::post('/api/teams', [TeamController::class, 'store']);
    Route::delete('/api/teams/{team}', [TeamController::class, 'destroy'])->whereNumber('team');
    Route::get('/api/teams/{team}/members', [TeamController::class, 'members'])->whereNumber('team');
    Route::post('/api/teams/{team}/members', [TeamController::class, 'addMember'])->whereNumber('team');
    Route::patch('/api/teams/{team}/members/{user}', [TeamController::class, 'updateMember'])
        ->whereNumber(['team', 'user']);
    Route::delete('/api/teams/{team}/members/{user}', [TeamController::class, 'removeMember'])
        ->whereNumber(['team', 'user']);
});

Route::prefix('admin')->middleware('admin')->group(function () {
    Route::get('/', [AdminController::class, 'page']);
    Route::get('/overview', [AdminController::class, 'overview']);
    Route::get('/users', [AdminController::class, 'users']);
    Route::patch('/users/{user}', [AdminController::class, 'updateUser']);
    Route::delete('/users/{user}', [AdminController::class, 'deleteUser']);
    Route::get('/maps', [AdminController::class, 'maps']);
    Route::get('/maps/{id}', [AdminController::class, 'map'])->whereNumber('id');
    Route::delete('/maps/{id}', [AdminController::class, 'deleteMap'])->whereNumber('id');
});
