<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Audit;
use App\Support\MapAccess;
use App\Support\MapHistory;
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
            ->when($q !== '', fn ($b) => $b->where(function ($w) use ($q) {
                $w->where('users.name', 'like', "%$q%")->orWhere('users.email', 'like', "%$q%");
            }))
            ->orderByDesc('users.created_at')
            ->paginate(self::PER_PAGE, [
                'users.id', 'users.name', 'users.email', 'users.created_at',
                'users.is_admin', 'users.banned_at',
                DB::raw('(select count(*) from maps where maps.user_id = users.id) as maps'),
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
                'maps.deleted_at', 'maps.bytes',
                'users.name as owner', 'users.email as owner_email',
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

    public function deleteMap(Request $request, int $id)
    {
        $row = DB::table('maps')->where('id', $id)->first(MapAccess::COLUMNS);
        abort_unless($row, 404);
        $purge = $request->boolean('purge');

        if ($purge) {
            MapHistory::forget($id);
            DB::table('maps')->where('id', $id)->delete();
        } else {
            MapHistory::snapshot($row, MapHistory::PRE_DELETE);
            DB::table('maps')->where('id', $id)->update(['deleted_at' => now()]);
        }
        Audit::log($purge ? 'admin.map_purge' : 'admin.map_delete', $id, ['name' => $row->name]);
        Cache::forget('admin_overview');

        return response()->json(['deleted' => true, 'purged' => $purge]);
    }

    public function restoreMap(int $id)
    {
        $row = DB::table('maps')->where('id', $id)->whereNotNull('deleted_at')->first(['id', 'name']);
        abort_unless($row, 404);

        DB::table('maps')->where('id', $id)->update(['deleted_at' => null, 'updated_at' => now()]);
        Audit::log('admin.map_restore', $id, ['name' => $row->name]);
        Cache::forget('admin_overview');

        return response()->json(['restored' => true]);
    }

    public function audit(Request $request)
    {
        $q = trim((string) $request->query('q', ''));

        return DB::table('audit_log')
            ->leftJoin('users', 'users.id', '=', 'audit_log.user_id')
            ->when($q !== '', fn ($b) => $b->where(function ($w) use ($q) {
                $w->where('audit_log.action', 'like', "%$q%")
                    ->orWhere('users.name', 'like', "%$q%")
                    ->orWhere('audit_log.meta', 'like', "%$q%");
            }))
            ->orderByDesc('audit_log.id')
            ->paginate(self::PER_PAGE, [
                'audit_log.id', 'audit_log.action', 'audit_log.subject_id', 'audit_log.team_id',
                'audit_log.meta', 'audit_log.ip', 'audit_log.created_at',
                'users.name as who',
            ]);
    }

    public function updateUser(Request $request, User $user)
    {
        $data = $request->validate(['banned' => ['required', 'boolean']]);
        $this->refuseSelf($user);

        $user->forceFill(['banned_at' => $data['banned'] ? now() : null])->save();
        Audit::log($data['banned'] ? 'admin.user_ban' : 'admin.user_unban', $user->id, ['name' => $user->name]);

        return response()->json(['banned_at' => $user->banned_at]);
    }

    public function deleteUser(User $user)
    {
        $this->refuseSelf($user);

        DB::transaction(function () use ($user) {
            DB::table('maps')->where('user_id', $user->id)->whereNull('deleted_at')
                ->update(['deleted_at' => now()]);
            $user->delete();
        });
        Audit::log('admin.user_delete', $user->id, ['name' => $user->name]);
        Cache::forget('admin_overview');

        return response()->json(['deleted' => true]);
    }

    /** Banning or deleting yourself would lock the only admin out of the panel. */
    private function refuseSelf(User $user): void
    {
        abort_if($user->id === Auth::id(), 422, 'You cannot do that to your own account.');
    }
}
