<?php

namespace App\Support;

use Illuminate\Contracts\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Every read and write of a map goes through here. A map belongs to one account,
 * or to a team, or to an anonymous browser cookie, and those are the only ways in.
 */
class MapAccess
{
    public const OWNER = 'owner';

    public const EDITOR = 'editor';

    public const VIEWER = 'viewer';

    /**
     * Anonymous per-visitor identity: a random cookie, no login.
     * Re-queued on every request so the cookie outlives the map TTL.
     */
    public static function token(Request $request): string
    {
        $t = $request->cookie('studio_token');
        if (! is_string($t) || ! preg_match('/^[A-Za-z0-9]{40}$/', $t)) {
            $t = Str::random(40);
        }
        Cookie::queue('studio_token', $t, 60 * 24 * 7);

        return $t;
    }

    /** @var array<int, array<int, string>> user_id => team_id => role */
    private static array $memberships = [];

    /** @return array<int, string> team_id => role */
    private static function memberships(): array
    {
        $id = Auth::id();
        if (! $id) {
            return [];
        }

        return self::$memberships[$id] ??= DB::table('team_members')
            ->where('user_id', $id)
            ->pluck('role', 'team_id')
            ->all();
    }

    public static function forgetMemberships(): void
    {
        self::$memberships = [];
    }

    /** Team ids the signed-in user belongs to. Empty for a guest. */
    public static function teamIds(): array
    {
        return array_keys(self::memberships());
    }

    /** Everything the caller may open: their own maps plus every team they are in. */
    public static function visible(Request $request): Builder
    {
        $id = Auth::id();
        if (! $id) {
            return DB::table('maps')->whereNull('deleted_at')
                ->whereNull('user_id')->whereNull('team_id')
                ->where('token', self::token($request));
        }

        $teams = self::teamIds();

        return DB::table('maps')->whereNull('deleted_at')->where(function ($q) use ($id, $teams) {
            $q->where(fn ($p) => $p->where('user_id', $id)->whereNull('team_id'));
            if ($teams) {
                $q->orWhereIn('team_id', $teams);
            }
        });
    }

    /** The caller's personal maps only, which is what their quota counts. */
    public static function personal(Request $request): Builder
    {
        $id = Auth::id();

        return $id
            ? DB::table('maps')->whereNull('deleted_at')->where('user_id', $id)->whereNull('team_id')
            : DB::table('maps')->whereNull('deleted_at')
                ->whereNull('user_id')->whereNull('team_id')
                ->where('token', self::token($request));
    }

    public static function trashed(Request $request): Builder
    {
        $id = Auth::id();
        if (! $id) {
            return DB::table('maps')->whereNotNull('deleted_at')
                ->whereNull('user_id')->whereNull('team_id')
                ->where('token', self::token($request));
        }

        $owned = DB::table('teams')->where('owner_id', $id)->pluck('id')->all();

        return DB::table('maps')->whereNotNull('deleted_at')->where(function ($q) use ($id, $owned) {
            $q->where(fn ($p) => $p->where('user_id', $id)->whereNull('team_id'));
            if ($owned) {
                $q->orWhereIn('team_id', $owned);
            }
        });
    }

    public const COLUMNS = [
        'id', 'name', 'token', 'user_id', 'team_id', 'saved_by', 'version',
        'parts', 'bytes', 'thumb_key', 'project_id', 'deleted_at', 'created_at', 'updated_at',
    ];

    public static function find(Request $request, string $name, ?int $teamId, bool $withBody = false)
    {
        $q = $teamId === null
            ? self::personal($request)
            : DB::table('maps')->whereNull('deleted_at')->where('team_id', $teamId);

        $columns = $withBody ? [...self::COLUMNS, 'data', 'groups', 'lights'] : self::COLUMNS;

        return $q->where('name', $name)->first($columns);
    }

    public static function body(int $id): ?object
    {
        return DB::table('maps')->where('id', $id)->first(['data', 'groups']);
    }

    /** Null means no access at all, which callers report as 404 rather than 403. */
    public static function role(?object $map): ?string
    {
        if (! $map) {
            return null;
        }

        if ($map->team_id) {
            return self::memberships()[$map->team_id] ?? null;
        }

        return self::OWNER;
    }

    public static function canEdit(?object $map): bool
    {
        return in_array(self::role($map), [self::OWNER, self::EDITOR], true);
    }

    /** Membership check for a team the caller names before any map exists in it. */
    public static function teamRole(?int $teamId): ?string
    {
        if ($teamId === null) {
            return self::OWNER;
        }

        return self::memberships()[$teamId] ?? null;
    }
}
