<?php

use App\Http\Controllers\MapController;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

const TPART = ['T' => 'Part', 'P' => [0, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];

function makeTeam(User $owner, string $name = 'Crew'): int
{
    return test()->actingAs($owner)->postJson('/api/teams', ['name' => $name])
        ->assertCreated()->json('id');
}

function addTo(int $team, User $owner, User $who, string $role = 'editor'): void
{
    test()->actingAs($owner)
        ->postJson("/api/teams/$team/members", ['email' => $who->email, 'role' => $role])
        ->assertOk();
}

it('creates a team with its creator as owner', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);

    expect(DB::table('team_members')->where('team_id', $team)->where('user_id', $a->id)->value('role'))
        ->toBe('owner');

    $this->actingAs($a)->getJson('/api/teams')->assertOk()
        ->assertJsonPath('teams.0.name', 'Crew')
        ->assertJsonPath('teams.0.role', 'owner');
});

it('lets any editor save a team map without the owner present', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART], 'groups' => []])
        ->assertOk();

    $this->actingAs($b)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART, TPART], 'groups' => []])
        ->assertOk();

    expect(DB::table('maps')->where('team_id', $team)->value('parts'))->toBe(2);
});

it('shows a team map to every member and lists the team', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);
    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART], 'groups' => []])->assertOk();

    $this->actingAs($b)->getJson("/api/maps/shared?team=$team")->assertOk()
        ->assertJsonPath('parts.0.T', 'Part');

    $this->actingAs($b)->getJson('/api/maps')->assertOk()
        ->assertJsonPath('mine.0.name', 'shared')
        ->assertJsonPath('teams.0.id', $team);
});

it('refuses a viewer the save but allows the read', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b, 'viewer');
    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART], 'groups' => []])->assertOk();

    $this->actingAs($b)->getJson("/api/maps/shared?team=$team")->assertOk();
    $this->actingAs($b)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART], 'groups' => []])
        ->assertStatus(403);
});

it('hides a team entirely from a non-member', function () {
    $a = User::factory()->create();
    $c = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART], 'groups' => []])->assertOk();

    $this->actingAs($c)->getJson("/api/maps/shared?team=$team")->assertNotFound();
    $this->actingAs($c)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART]])->assertNotFound();
    $this->actingAs($c)->getJson("/api/teams/$team/members")->assertNotFound();
    $this->actingAs($c)->getJson('/api/maps')->assertOk()->assertJsonCount(0, 'mine');
});

it('refuses a save built on a stale version', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $v = $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART]])->json('version');
    $this->actingAs($b)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART, TPART], 'version' => $v])
        ->assertOk();

    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART], 'version' => $v])
        ->assertStatus(409)
        ->assertJsonPath('error', 'stale');

    expect(DB::table('maps')->where('team_id', $team)->value('parts'))->toBe(2);
});

it('keeps personal and team quotas separate', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);

    for ($i = 0; $i < 50; $i++) {
        DB::table('maps')->insert([
            'token' => str_repeat('A', 40), 'name' => "p$i", 'data' => '[]', 'parts' => 0,
            'user_id' => $a->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    $this->actingAs($a)->putJson('/api/maps/one-more', ['parts' => [TPART]])->assertStatus(403);
    $this->actingAs($a)->putJson("/api/maps/one-more?team=$team", ['parts' => [TPART]])->assertOk();
});

it('spares team maps from the anonymous prune', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART]])->assertOk();

    DB::table('maps')->update(['updated_at' => now()->subHours(48)]);
    $this->travel(48)->hours();

    MapController::prune();

    expect(DB::table('maps')->where('team_id', $team)->whereNull('deleted_at')->count())->toBe(1);
});

it('lets a personal and a team map share a name', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);

    $this->actingAs($a)->putJson('/api/maps/castle', ['parts' => [TPART]])->assertOk();
    $this->actingAs($a)->putJson("/api/maps/castle?team=$team", ['parts' => [TPART, TPART]])->assertOk();

    expect(DB::table('maps')->where('name', 'castle')->count())->toBe(2);
    $this->actingAs($a)->getJson('/api/maps/castle')->assertOk()->assertJsonCount(1, 'parts');
    $this->actingAs($a)->getJson("/api/maps/castle?team=$team")->assertOk()->assertJsonCount(2, 'parts');
});

it('only lets the owner manage members', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $this->actingAs($b)->postJson("/api/teams/$team/members", ['email' => $c->email])->assertStatus(403);
    $this->actingAs($b)->patchJson("/api/teams/$team/members/{$b->id}", ['role' => 'viewer'])->assertStatus(403);

    $this->actingAs($a)->patchJson("/api/teams/$team/members/{$b->id}", ['role' => 'viewer'])->assertOk();
    expect(DB::table('team_members')->where('user_id', $b->id)->value('role'))->toBe('viewer');
});

it('shows addresses to the owner only, plus your own', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);
    addTo($team, $a, $c);

    $seen = collect($this->actingAs($a)->getJson("/api/teams/$team/members")->json('members'))
        ->pluck('email', 'id');
    expect($seen[$b->id])->toBe($b->email);
    expect($seen[$c->id])->toBe($c->email);

    $seen = collect($this->actingAs($b)->getJson("/api/teams/$team/members")->json('members'))
        ->pluck('email', 'id');
    expect($seen[$b->id])->toBe($b->email);
    expect($seen[$a->id])->toBeNull();
    expect($seen[$c->id])->toBeNull();
});

it('lets a member leave but not the owner', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $this->actingAs($a)->deleteJson("/api/teams/$team/members/{$a->id}")->assertStatus(422);
    $this->actingAs($b)->deleteJson("/api/teams/$team/members/{$b->id}")->assertOk();

    $this->actingAs($b)->getJson('/api/maps')->assertOk()->assertJsonCount(0, 'mine');
});

it('refuses an unknown address and a duplicate member', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);

    $this->actingAs($a)->postJson("/api/teams/$team/members", ['email' => 'nobody@example.com'])
        ->assertStatus(422);
    addTo($team, $a, $b);
    $this->actingAs($a)->postJson("/api/teams/$team/members", ['email' => $b->email])->assertStatus(422);
});

it('needs an account for anything to do with teams', function () {
    $this->postJson('/api/teams', ['name' => 'Crew'])->assertStatus(401);
    $this->getJson('/api/teams')->assertStatus(401);
});

it('leaves the anonymous flow untouched', function () {
    asToken()->putJson('/api/maps/anon', [TPART])->assertOk();
    asToken()->getJson('/api/maps/anon')->assertOk()->assertJsonPath('parts.0.T', 'Part');
    asToken()->getJson('/api/maps')->assertOk()
        ->assertJsonPath('mine.0.name', 'anon')
        ->assertJsonPath('teams', []);
});

it('refuses a second team with the same name for one owner', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    makeTeam($a, 'Crew');

    $this->actingAs($a)->postJson('/api/teams', ['name' => 'Crew'])->assertStatus(422);
    $this->actingAs($a)->postJson('/api/teams', ['name' => '  Crew  '])->assertStatus(422);
    $this->actingAs($b)->postJson('/api/teams', ['name' => 'Crew'])->assertCreated();
});

it('deletes a team and hands its maps back to the owner', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);
    $this->actingAs($a)->putJson("/api/maps/keep?team=$team", ['parts' => [TPART]])->assertOk();

    $this->actingAs($a)->deleteJson("/api/teams/$team")->assertOk()->assertJson(['moved' => 1]);

    expect(DB::table('teams')->count())->toBe(0)
        ->and(DB::table('team_members')->count())->toBe(0);

    $row = DB::table('maps')->where('name', 'keep')->first();
    expect($row->team_id)->toBeNull()->and($row->user_id)->toBe($a->id);

    $this->actingAs($a)->getJson('/api/maps/keep')->assertOk();
    $this->actingAs($b)->getJson('/api/maps')->assertOk()->assertJsonCount(0, 'mine');
});

it('renames a returning map that would collide', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson('/api/maps/castle', ['parts' => [TPART]])->assertOk();
    $this->actingAs($a)->putJson("/api/maps/castle?team=$team", ['parts' => [TPART, TPART]])->assertOk();

    $this->actingAs($a)->deleteJson("/api/teams/$team")->assertOk();

    expect(DB::table('maps')->where('user_id', $a->id)->pluck('name')->sort()->values()->all())
        ->toBe(['castle', 'castle-2']);
    $this->actingAs($a)->getJson('/api/maps/castle-2')->assertOk()->assertJsonCount(2, 'parts');
});

it('only lets the owner delete a team', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $this->actingAs($b)->deleteJson("/api/teams/$team")->assertStatus(403);
    $this->actingAs($c)->deleteJson("/api/teams/$team")->assertNotFound();
    expect(DB::table('teams')->count())->toBe(1);
});

it('refuses the delete when the maps would not fit', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson("/api/maps/extra?team=$team", ['parts' => [TPART]])->assertOk();

    for ($i = 0; $i < 50; $i++) {
        DB::table('maps')->insert([
            'token' => str_repeat('A', 40), 'name' => "p$i", 'data' => '[]', 'parts' => 0,
            'user_id' => $a->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    $this->actingAs($a)->deleteJson("/api/teams/$team")->assertStatus(403);
    expect(DB::table('teams')->count())->toBe(1)
        ->and(DB::table('maps')->where('team_id', $team)->count())->toBe(1);
});

it('adds a member by username as well as by email', function () {
    $a = User::factory()->create();
    $b = User::factory()->create(['name' => 'Ada']);
    $c = User::factory()->create();
    $team = makeTeam($a);

    $this->actingAs($a)->postJson("/api/teams/$team/members", ['who' => 'Ada'])->assertOk();
    $this->actingAs($a)->postJson("/api/teams/$team/members", ['who' => $c->email])->assertOk();

    expect(DB::table('team_members')->where('team_id', $team)->count())->toBe(3)
        ->and(DB::table('team_members')->where('user_id', $b->id)->exists())->toBeTrue();
});

it('matches a username whatever its case', function () {
    $a = User::factory()->create();
    User::factory()->create(['name' => 'Ada']);
    $team = makeTeam($a);

    $this->actingAs($a)->postJson("/api/teams/$team/members", ['who' => 'aDa'])->assertOk();
    expect(DB::table('team_members')->where('team_id', $team)->count())->toBe(2);
});

it('refuses a username nobody has', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);

    $this->actingAs($a)->postJson("/api/teams/$team/members", ['who' => 'nobody-at-all'])
        ->assertStatus(422);
});

it('keeps usernames unique, whatever the case', function () {
    $this->postJson('/account/register', [
        'name' => 'Ada', 'email' => 'a@example.com',
        'password' => 'correct horse', 'password_confirmation' => 'correct horse',
    ])->assertOk();

    $this->postJson('/account/register', [
        'name' => 'ada', 'email' => 'b@example.com',
        'password' => 'correct horse', 'password_confirmation' => 'correct horse',
    ])->assertStatus(422);
});

it('moves a personal map into a team and back out', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson('/api/maps/castle', ['parts' => [TPART]])->assertOk();

    $this->actingAs($a)->patchJson('/api/maps/castle', ['to_team' => $team])
        ->assertOk()->assertJsonPath('team_id', $team);
    expect(DB::table('maps')->where('name', 'castle')->value('team_id'))->toBe($team);
    $this->actingAs($a)->getJson("/api/maps/castle?team=$team")->assertOk()->assertJsonCount(1, 'parts');

    $this->actingAs($a)->patchJson("/api/maps/castle?team=$team", ['to_team' => null])->assertOk();
    expect(DB::table('maps')->where('name', 'castle')->value('team_id'))->toBeNull();
});

it('keeps the map contents and groups when it moves', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $part = TPART + ['_id' => 'p1'];
    $this->actingAs($a)->putJson('/api/maps/castle', [
        'parts' => [$part], 'groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['p1']]],
    ])->assertOk();

    $this->actingAs($a)->patchJson('/api/maps/castle', ['to_team' => $team])->assertOk();

    $this->actingAs($a)->getJson("/api/maps/castle?team=$team")->assertOk()
        ->assertJsonPath('parts.0._id', 'p1')
        ->assertJsonPath('groups.0.name', 'Wall');
});

it('refuses a move onto a name already taken there', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson('/api/maps/castle', ['parts' => [TPART]])->assertOk();
    $this->actingAs($a)->putJson("/api/maps/castle?team=$team", ['parts' => [TPART, TPART]])->assertOk();

    $this->actingAs($a)->patchJson('/api/maps/castle', ['to_team' => $team])->assertStatus(422);
    expect(DB::table('maps')->where('name', 'castle')->whereNull('team_id')->count())->toBe(1);
});

it('lets an editor move a map in but only the owner move one out', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $this->actingAs($b)->putJson('/api/maps/theirs', ['parts' => [TPART]])->assertOk();
    $this->actingAs($b)->patchJson('/api/maps/theirs', ['to_team' => $team])->assertOk();

    $this->actingAs($b)->patchJson("/api/maps/theirs?team=$team", ['to_team' => null])->assertStatus(403);
    $this->actingAs($a)->patchJson("/api/maps/theirs?team=$team", ['to_team' => null])->assertOk();
    expect(DB::table('maps')->where('name', 'theirs')->value('user_id'))->toBe($a->id);
});

it('refuses a move into a team you cannot edit', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b, 'viewer');

    $this->actingAs($b)->putJson('/api/maps/mine', ['parts' => [TPART]])->assertOk();
    $this->actingAs($b)->patchJson('/api/maps/mine', ['to_team' => $team])->assertStatus(403);

    $this->actingAs($c)->putJson('/api/maps/mine', ['parts' => [TPART]])->assertOk();
    $this->actingAs($c)->patchJson('/api/maps/mine', ['to_team' => $team])->assertNotFound();
});

it('refuses a move that would break the destination quota', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson('/api/maps/castle', ['parts' => [TPART]])->assertOk();

    for ($i = 0; $i < 200; $i++) {
        DB::table('maps')->insert([
            'token' => str_repeat('A', 40), 'name' => "t$i", 'data' => '[]', 'parts' => 0,
            'user_id' => $a->id, 'team_id' => $team, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    $this->actingAs($a)->patchJson('/api/maps/castle', ['to_team' => $team])->assertStatus(403);
});

it('renames a map and refuses a name already in use', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/old', ['parts' => [TPART]])->assertOk();
    $this->actingAs($a)->putJson('/api/maps/taken', ['parts' => [TPART]])->assertOk();

    $this->actingAs($a)->patchJson('/api/maps/old', ['to_name' => 'fresh'])->assertOk();
    expect(DB::table('maps')->where('name', 'fresh')->exists())->toBeTrue();

    $this->actingAs($a)->patchJson('/api/maps/fresh', ['to_name' => 'taken'])->assertStatus(422);
    $this->actingAs($a)->patchJson('/api/maps/fresh', ['to_name' => 'bad name!'])->assertStatus(400);
});

it('deletes a map and lets only the team owner delete a team one', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = makeTeam($a);
    addTo($team, $a, $b);

    $this->actingAs($a)->putJson('/api/maps/gone', ['parts' => [TPART]])->assertOk();
    $this->actingAs($a)->deleteJson('/api/maps/gone')->assertOk();
    expect(DB::table('maps')->where('name', 'gone')->whereNull('deleted_at')->exists())->toBeFalse();

    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART]])->assertOk();
    $this->actingAs($b)->deleteJson("/api/maps/shared?team=$team")->assertStatus(403);
    $this->actingAs($a)->deleteJson("/api/maps/shared?team=$team")->assertOk();
    expect(DB::table('maps')->whereNull('deleted_at')->count())->toBe(0);
});

it('keeps one team map from renaming onto another', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson("/api/maps/one?team=$team", ['parts' => [TPART]])->assertOk();
    $this->actingAs($a)->putJson("/api/maps/two?team=$team", ['parts' => [TPART]])->assertOk();

    $this->actingAs($a)->patchJson("/api/maps/one?team=$team", ['to_name' => 'two'])->assertStatus(422);
    $this->actingAs($a)->putJson('/api/maps/two', ['parts' => [TPART]])->assertOk();
});
