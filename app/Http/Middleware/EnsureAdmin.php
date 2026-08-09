<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class EnsureAdmin
{
    public function handle(Request $request, Closure $next)
    {
        $user = Auth::user();
        if ($user && $user->is_admin && ! $user->banned_at) {
            return $next($request);
        }

        if ($request->expectsJson()) {
            abort(404);
        }

        return response()->view('no-admin', [], 404);
    }
}
