<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class BlockBanned
{
    public function handle(Request $request, Closure $next)
    {
        if (Auth::user()?->banned_at) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return $next($request);
    }
}
