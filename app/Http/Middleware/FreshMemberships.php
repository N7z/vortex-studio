<?php

namespace App\Http\Middleware;

use App\Support\MapAccess;
use Closure;
use Illuminate\Http\Request;

class FreshMemberships
{
    public function handle(Request $request, Closure $next)
    {
        MapAccess::forgetMemberships();

        return $next($request);
    }
}
