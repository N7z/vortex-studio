<?php

namespace App\Http\Middleware;

use App\Support\MapAccess;
use Closure;
use Illuminate\Http\Request;

/** MapAccess memoises membership in a static, which outlives the request under a
 * persistent worker and in the test suite. */
class FreshMemberships
{
    public function handle(Request $request, Closure $next)
    {
        MapAccess::forgetMemberships();

        return $next($request);
    }
}
