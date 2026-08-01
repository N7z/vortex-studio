<?php

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

    // 404 not 403: the team's existence is not disclosed.
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
    // The team has its own allowance, so a full personal space does not block it.
    $this->actingAs($a)->putJson("/api/maps/one-more?team=$team", ['parts' => [TPART]])->assertOk();
});

it('spares team maps from the anonymous prune', function () {
    $a = User::factory()->create();
    $team = makeTeam($a);
    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", ['parts' => [TPART]])->assertOk();

    DB::table('maps')->update(['updated_at' => now()->subHours(48)]);
    $this->travel(48)->hours();

    $this->getJson('/api/stats')->assertOk();

    expect(DB::table('maps')->where('team_id', $team)->count())->toBe(1);
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
    // Another account is free to use the same name.
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
    // The team's copy is the one that moved, so its contents are intact.
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
