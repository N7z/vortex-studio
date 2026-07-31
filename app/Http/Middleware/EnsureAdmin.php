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
        if ($user && $user->is_admin && ! $user->banned_at) {
            return $next($request);
        }

        // Still a 404, so the admin API keeps answering the way its callers expect;
        // only a browser asking for a page gets the picture instead of a blank error.
        if ($request->expectsJson()) {
            abort(404);
        }

        return response()->view('no-admin', [], 404);
    }
}
