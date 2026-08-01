<?php

use App\Http\Controllers\MapController;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

const APART = ['T' => 'Part', 'P' => [0, 0.5, 0], 'S' => [4, 1, 4], 'R' => [0, 0, 0], 'C' => 'a3a2a5', 'Tr' => 0];

function account(array $over = []): array
{
    return [
        'name' => 'Paulin',
        'email' => 'p@example.com',
        'password' => 'correct horse',
        'password_confirmation' => 'correct horse',
    ] + $over;
}

it('registers, reports the account and signs out', function () {
    $this->postJson('/account/register', account())->assertOk()->assertJson(['account' => ['name' => 'Paulin']]);
    $this->getJson('/account')->assertOk()->assertJson(['account' => ['email' => 'p@example.com']]);

    $this->postJson('/account/logout')->assertOk()->assertJson(['account' => null]);
    $this->getJson('/account')->assertOk()->assertJson(['account' => null]);
});

it('rejects a duplicate email, a short password and a mismatch', function () {
    $this->postJson('/account/register', account())->assertOk();
    $this->postJson('/account/logout');

    $this->postJson('/account/register', account())->assertStatus(422);
    $this->postJson('/account/register', ['name' => 'x', 'email' => 'a@b.co', 'password' => 'short', 'password_confirmation' => 'short'])->assertStatus(422);
    $this->postJson('/account/register', ['name' => 'x', 'email' => 'a@b.co', 'password' => 'longenough1', 'password_confirmation' => 'different1'])->assertStatus(422);
});

it('refuses a wrong password without saying which field was wrong', function () {
    User::create(['name' => 'P', 'email' => 'p@example.com', 'password' => 'correct horse']);

    $this->postJson('/account/login', ['email' => 'p@example.com', 'password' => 'nope'])->assertStatus(422);
    $this->postJson('/account/login', ['email' => 'nobody@example.com', 'password' => 'nope'])->assertStatus(422);
    $this->postJson('/account/login', ['email' => 'p@example.com', 'password' => 'correct horse'])->assertOk();
});

it('issues a live token only to a signed-in user with a secret configured', function () {
    config(['services.live.secret' => 'shared-with-laravel']);

    $this->getJson('/account/live-token')->assertOk()->assertJson(['token' => null]);

    $user = User::create(['name' => 'zpaulin', 'email' => 'p@example.com', 'password' => 'correct horse']);
    $token = $this->actingAs($user)->getJson('/account/live-token')->assertOk()->json('token');

    [$payload, $exp, $sig] = explode('.', $token);
    $claim = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
    expect($claim['v'])->toBe(2)
        ->and($claim['n'])->toBe('zpaulin')
        ->and($claim['u'])->toBe($user->id)
        // No map was named, so the token proves the name and claims no rights.
        ->and($claim['m'])->toBeNull()
        ->and($claim['r'])->toBeNull();
    expect((int) $exp)->toBeGreaterThan(time());
    expect($sig)->toBe(hash_hmac('sha256', "$payload.$exp", 'shared-with-laravel'));
});

it('claims the team role on a team map, so the room knows its owner', function () {
    config(['services.live.secret' => 'shared-with-laravel']);
    $a = User::factory()->create();
    $b = User::factory()->create();

    $team = $this->actingAs($a)->postJson('/api/teams', ['name' => 'Crew'])->json('id');
    $this->actingAs($a)->postJson("/api/teams/$team/members", ['email' => $b->email, 'role' => 'viewer'])
        ->assertOk();
    $this->actingAs($a)->putJson("/api/maps/shared?team=$team", [
        'parts' => [['T' => 'Part', 'P' => [0, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]]],
    ])->assertOk();

    $claim = fn ($user, $q) => json_decode(base64_decode(strtr(
        explode('.', $this->actingAs($user)->getJson("/account/live-token?$q")->json('token'))[0],
        '-_',
        '+/',
    )), true);

    $c = User::factory()->create();
    $this->actingAs($a)->postJson("/api/teams/$team/members", ['who' => $c->email])->assertOk();

    expect($claim($a, "map=shared&team=$team")['r'])->toBe('owner')
        ->and($claim($c, "map=shared&team=$team")['r'])->toBe('editor')
        ->and($claim($b, "map=shared&team=$team")['r'])->toBe('viewer')
        // A personal map is always the caller's own.
        ->and($claim($a, 'map=solo')['r'])->toBe('editor')
        // A team you are not in resolves to nothing at all, not to a claim.
        ->and($claim(User::factory()->create(), "map=shared&team=$team")['m'])->toBeNull();
});

it('issues no live token when no secret is configured', function () {
    config(['services.live.secret' => null]);
    $user = User::create(['name' => 'zpaulin', 'email' => 'p@example.com', 'password' => 'correct horse']);

    $this->actingAs($user)->getJson('/account/live-token')->assertOk()->assertJson(['token' => null]);
});

it('leaves the anonymous flow working with no account', function () {
    asToken()->putJson('/api/maps/anon', [APART])->assertOk();
    asToken()->getJson('/api/maps/anon')->assertOk()->assertJson(['parts' => [APART]]);
    asToken()->getJson('/api/maps')->assertOk()->assertJson(['account' => null, 'mine' => [['name' => 'anon']]]);
});

it('claims the maps made in this browser when signing in', function () {
    asToken()->putJson('/api/maps/before', [APART])->assertOk();

    asToken()->postJson('/account/register', account())->assertOk()->assertJson(['claimed' => 1]);

    expect(DB::table('maps')->where('name', 'before')->value('user_id'))->toBe(User::first()->id);
    $this->getJson('/api/maps')->assertOk()->assertJson(['mine' => [['name' => 'before']]]);
});

it('renames a claimed map rather than overwriting one the account already has', function () {
    $user = User::create(['name' => 'P', 'email' => 'p@example.com', 'password' => 'correct horse']);
    DB::table('maps')->insert([
        'user_id' => $user->id, 'token' => str_repeat('B', 40), 'name' => 'dup',
        'data' => '["kept"]', 'created_at' => now(), 'updated_at' => now(),
    ]);

    asToken()->putJson('/api/maps/dup', [APART])->assertOk();
    asToken()->postJson('/account/login', ['email' => 'p@example.com', 'password' => 'correct horse'])
        ->assertOk()->assertJson(['claimed' => 1]);

    expect(DB::table('maps')->where('user_id', $user->id)->pluck('name')->sort()->values()->all())
        ->toBe(['dup', 'dup-2']);
    expect(DB::table('maps')->where('name', 'dup')->value('data'))->toBe('["kept"]');
});

it('keeps an account s maps past the anonymous TTL', function () {
    $user = User::create(['name' => 'P', 'email' => 'p@example.com', 'password' => 'correct horse']);
    $old = now()->subHours(48);
    DB::table('maps')->insert([
        ['user_id' => $user->id, 'token' => str_repeat('B', 40), 'name' => 'owned', 'data' => '[]', 'created_at' => $old, 'updated_at' => $old],
        ['user_id' => null, 'token' => str_repeat('C', 40), 'name' => 'stale', 'data' => '[]', 'created_at' => $old, 'updated_at' => $old],
    ]);

    MapController::prune();

    // Expiring is a move to the trash, so a token lost on the last day is recoverable.
    expect(DB::table('maps')->whereNull('deleted_at')->pluck('name')->all())->toBe(['owned'])
        ->and(DB::table('maps')->whereNotNull('deleted_at')->pluck('name')->all())->toBe(['stale']);
});

it('does not show one account the maps of another', function () {
    $mine = User::create(['name' => 'A', 'email' => 'a@example.com', 'password' => 'correct horse']);
    $other = User::create(['name' => 'B', 'email' => 'b@example.com', 'password' => 'correct horse']);
    DB::table('maps')->insert([
        'user_id' => $other->id, 'token' => str_repeat('B', 40), 'name' => 'secret',
        'data' => '[]', 'created_at' => now(), 'updated_at' => now(),
    ]);

    $this->actingAs($mine)->getJson('/api/maps')->assertOk()->assertJsonCount(0, 'mine');
    $this->actingAs($mine)->getJson('/api/maps/secret')->assertStatus(404);
});

it('follows the account rather than the cookie once signed in', function () {
    $user = User::create(['name' => 'P', 'email' => 'p@example.com', 'password' => 'correct horse']);

    $this->actingAs($user)->putJson('/api/maps/mine', [APART])->assertOk();
    expect(DB::table('maps')->where('name', 'mine')->value('user_id'))->toBe($user->id);

    // Signed out, the same browser sees its own anonymous maps, not the account's.
    Auth::logout();
    asToken()->getJson('/api/maps/mine')->assertStatus(404);
});
