<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/** 404 rather than 403: an admin area nobody can reach should not announce itself. */
class EnsureAdmin
{
    public function handle(Request $request, Closure $next)
    {
        $user = Auth::user();
        abort_unless($user && $user->is_admin && ! $user->banned_at, 404);

        return $next($request);
    }
}
