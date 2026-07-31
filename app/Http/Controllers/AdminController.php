<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Stats;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class AdminController extends Controller
{
    private const PER_PAGE = 25;

    private const HISTORY_DAYS = 90;

    public function page()
    {
        return view('admin');
    }

    public function overview()
    {
        // Only plain arrays are cached: a serialized Collection can come back as an
        // incomplete class and then encodes as a JSON object, which the charts read
        // as "not a list" and refuse to render.
        return ['me' => Auth::id()] + Cache::remember('admin_overview', 60, fn () => [
            'totals' => Stats::totals(),
            'history' => DB::table('daily_stats')
                ->where('day', '>=', $this->since())
                ->orderBy('day')
                ->get(['day', 'users', 'maps', 'maps_anon', 'parts'])->toArray(),
            'signups' => DB::table('users')
                ->where('created_at', '>=', $this->since())
                ->selectRaw('date(created_at) as day, count(*) as accounts')
                ->groupBy('day')->orderBy('day')->get()->toArray(),
            'created' => DB::table('maps')
                ->where('created_at', '>=', $this->since())
                ->selectRaw('date(created_at) as day')
                ->selectRaw('count(case when user_id is null then 1 end) as anon')
                ->selectRaw('count(case when user_id is not null then 1 end) as account')
                ->groupBy('day')->orderBy('day')->get()->toArray(),
        ]);
    }

    private function since(): string
    {
        return now()->subDays(self::HISTORY_DAYS)->startOfDay()->toDateTimeString();
    }

    public function users(Request $request)
    {
        $q = trim((string) $request->query('q', ''));

        return DB::table('users')
            ->leftJoin('maps', 'maps.user_id', '=', 'users.id')
            ->when($q !== '', fn ($b) => $b->where(function ($w) use ($q) {
                $w->where('users.name', 'like', "%$q%")->orWhere('users.email', 'like', "%$q%");
            }))
            ->groupBy('users.id', 'users.name', 'users.email', 'users.created_at', 'users.is_admin', 'users.banned_at')
            ->orderByDesc('users.created_at')
            ->paginate(self::PER_PAGE, [
                'users.id', 'users.name', 'users.email', 'users.created_at',
                'users.is_admin', 'users.banned_at',
                DB::raw('count(maps.id) as maps'),
            ]);
    }

    public function maps(Request $request)
    {
        $q = trim((string) $request->query('q', ''));

        // Never select `data`: a map is up to 2 MB and there is no bound on rows.
        return DB::table('maps')
            ->leftJoin('users', 'users.id', '=', 'maps.user_id')
            ->when($q !== '', fn ($b) => $b->where('maps.name', 'like', "%$q%"))
            ->orderByDesc('maps.updated_at')
            ->paginate(self::PER_PAGE, [
                'maps.id', 'maps.name', 'maps.user_id', 'maps.created_at', 'maps.updated_at',
                'users.name as owner', 'users.email as owner_email',
                DB::raw('length(maps.data) as bytes'),
            ]);
    }

    /** Read-only view of somebody else's map, for the studio's `?view=` mode. */
    public function map(int $id)
    {
        $row = DB::table('maps')->where('id', $id)->first(['name', 'data']);
        abort_unless($row, 404);

        return response()->json([
            'name' => $row->name,
            'parts' => json_decode((string) $row->data, true) ?: [],
        ]);
    }

    public function deleteMap(int $id)
    {
        $deleted = DB::table('maps')->where('id', $id)->delete();
        abort_unless($deleted, 404);
        Cache::forget('admin_overview');

        return response()->json(['deleted' => true]);
    }

    public function updateUser(Request $request, User $user)
    {
        $data = $request->validate(['banned' => ['required', 'boolean']]);
        $this->refuseSelf($user);

        $user->forceFill(['banned_at' => $data['banned'] ? now() : null])->save();

        return response()->json(['banned_at' => $user->banned_at]);
    }

    public function deleteUser(User $user)
    {
        $this->refuseSelf($user);

        DB::transaction(function () use ($user) {
            DB::table('maps')->where('user_id', $user->id)->delete();
            $user->delete();
        });
        Cache::forget('admin_overview');

        return response()->json(['deleted' => true]);
    }

    /** Banning or deleting yourself would lock the only admin out of the panel. */
    private function refuseSelf(User $user): void
    {
        abort_if($user->id === Auth::id(), 422, 'You cannot do that to your own account.');
    }
}
