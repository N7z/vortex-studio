<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\MapAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class TeamController extends Controller
{
    private const MAX_TEAMS_PER_USER = 10;

    private const MAX_MEMBERS = 25;

    private const MAX_PERSONAL_MAPS = 50;

    private const ROLES = [MapAccess::EDITOR, MapAccess::VIEWER];

    private function me(): int
    {
        $id = Auth::id();
        abort_unless($id, 401, 'sign in first');

        return $id;
    }

    /** 404 rather than 403: a team you are not in should not be discoverable. */
    private function member(int $teamId): object
    {
        $row = DB::table('team_members')
            ->where('team_id', $teamId)->where('user_id', $this->me())->first();
        abort_unless($row, 404);

        return $row;
    }

    private function owner(int $teamId): void
    {
        abort_unless($this->member($teamId)->role === MapAccess::OWNER, 403, 'only the team owner can do that');
    }

    public function index()
    {
        $this->me();

        return response()->json(['teams' => $this->listFor($this->me())]);
    }

    private function listFor(int $userId): array
    {
        return DB::table('team_members')
            ->join('teams', 'teams.id', '=', 'team_members.team_id')
            ->where('team_members.user_id', $userId)
            ->orderBy('teams.name')
            ->get(['teams.id', 'teams.name', 'team_members.role'])
            ->map(fn ($t) => ['id' => $t->id, 'name' => $t->name, 'role' => $t->role])
            ->all();
    }

    public function store(Request $request)
    {
        $me = $this->me();
        $data = $request->validate(['name' => ['required', 'string', 'max:64']]);
        $data['name'] = trim($data['name']);
        abort_if($data['name'] === '', 422, 'a team needs a name');

        abort_if(
            DB::table('teams')->where('owner_id', $me)->count() >= self::MAX_TEAMS_PER_USER,
            403,
            'team limit reached',
        );
        abort_if(
            DB::table('teams')->where('owner_id', $me)->where('name', $data['name'])->exists(),
            422,
            'you already have a team with that name',
        );

        $id = DB::transaction(function () use ($me, $data) {
            $id = DB::table('teams')->insertGetId([
                'name' => $data['name'], 'owner_id' => $me,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('team_members')->insert([
                'team_id' => $id, 'user_id' => $me, 'role' => MapAccess::OWNER,
                'created_at' => now(), 'updated_at' => now(),
            ]);

            return $id;
        });

        return response()->json(['id' => $id, 'name' => $data['name'], 'role' => MapAccess::OWNER], 201);
    }

    public function members(int $team)
    {
        $this->member($team);

        return response()->json([
            'members' => DB::table('team_members')
                ->join('users', 'users.id', '=', 'team_members.user_id')
                ->where('team_members.team_id', $team)
                ->orderBy('team_members.created_at')
                ->get(['users.id', 'users.name', 'users.email', 'team_members.role'])
                ->map(fn ($m) => [
                    'id' => $m->id, 'name' => $m->name, 'email' => $m->email, 'role' => $m->role,
                ]),
        ]);
    }

    public function addMember(Request $request, int $team)
    {
        $this->owner($team);
        $data = $request->validate([
            'who' => ['required_without:email', 'nullable', 'string', 'max:255'],
            'email' => ['required_without:who', 'nullable', 'string', 'max:255'],
            'role' => ['nullable', 'in:'.implode(',', self::ROLES)],
        ]);

        $who = trim((string) ($data['who'] ?? $data['email']));
        abort_if($who === '', 422, 'name or email needed');

        $column = str_contains($who, '@') ? 'email' : 'name';
        $user = User::whereRaw("lower($column) = ?", [mb_strtolower($who)])->first();
        abort_unless($user, 422, 'nobody could be added with that name or email');

        abort_if(
            DB::table('team_members')->where('team_id', $team)->count() >= self::MAX_MEMBERS,
            403,
            'member limit reached',
        );
        abort_if(
            DB::table('team_members')->where('team_id', $team)->where('user_id', $user->id)->exists(),
            422,
            'they are already in this team',
        );

        DB::table('team_members')->insert([
            'team_id' => $team, 'user_id' => $user->id,
            'role' => $data['role'] ?? MapAccess::EDITOR,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }

    public function updateMember(Request $request, int $team, int $user)
    {
        $this->owner($team);
        $data = $request->validate(['role' => ['required', 'in:'.implode(',', self::ROLES)]]);
        abort_if($user === $this->me(), 422, 'the owner keeps their own role');

        $changed = DB::table('team_members')
            ->where('team_id', $team)->where('user_id', $user)
            ->update(['role' => $data['role'], 'updated_at' => now()]);
        abort_unless($changed, 404);

        return response()->json(['ok' => true]);
    }

    /**
     * The team goes, its maps do not: nothing else in the app can delete a map, so
     * dropping them here would be the only way to lose work and it would be silent.
     * They move to the owner's own space instead, renamed where that collides.
     */
    public function destroy(int $team)
    {
        $me = $this->me();
        $this->owner($team);

        $maps = DB::table('maps')->where('team_id', $team)->orderBy('id')->get(['id', 'name']);
        $taken = DB::table('maps')->where('user_id', $me)->whereNull('team_id')
            ->pluck('name')->flip()->all();

        abort_if(
            count($taken) + $maps->count() > self::MAX_PERSONAL_MAPS,
            403,
            'your own space has no room for this team\'s maps',
        );

        DB::transaction(function () use ($team, $me, $maps, &$taken) {
            foreach ($maps as $map) {
                $name = $this->freeName($map->name, $taken);
                if ($name === null) {
                    continue;
                }
                $taken[$name] = true;
                DB::table('maps')->where('id', $map->id)
                    ->update(['user_id' => $me, 'team_id' => null, 'name' => $name, 'updated_at' => now()]);
            }
            DB::table('team_members')->where('team_id', $team)->delete();
            DB::table('teams')->where('id', $team)->delete();
        });

        return response()->json(['ok' => true, 'moved' => $maps->count()]);
    }

    private function freeName(string $name, array $taken): ?string
    {
        if (! isset($taken[$name])) {
            return $name;
        }
        $stem = substr($name, 0, 60);
        for ($n = 2; $n < 100; $n++) {
            if (! isset($taken["$stem-$n"])) {
                return "$stem-$n";
            }
        }

        return null;
    }

    /** The owner removes anyone but themselves; anyone else may only leave. */
    public function removeMember(int $team, int $user)
    {
        $mine = $this->member($team);
        if ($user !== $this->me()) {
            abort_unless($mine->role === MapAccess::OWNER, 403, 'only the team owner can do that');
        }
        abort_if($user === $this->me() && $mine->role === MapAccess::OWNER, 422, 'the owner cannot leave their own team');

        $gone = DB::table('team_members')
            ->where('team_id', $team)->where('user_id', $user)->delete();
        abort_unless($gone, 404);

        return response()->json(['ok' => true]);
    }
}
