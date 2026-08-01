<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

function admin(): User
{
    return User::where('email', 'boss@example.com')->first()
        ?? member(['name' => 'Boss', 'email' => 'boss@example.com', 'is_admin' => true]);
}

function member(array $over = []): User
{
    static $n = 0;
    $n++;
    $user = User::create($over + [
        'name' => $n === 1 ? 'Member' : "Member $n", 'email' => 'm@example.com', 'password' => 'correct horse',
    ]);

    // is_admin and banned_at are not fillable: nothing but the console and the panel sets them.
    $user->forceFill(array_intersect_key($over, ['is_admin' => 0, 'banned_at' => 0]))->save();

    return $user;
}

function aMap(array $over = []): int
{
    $row = $over + [
        'token' => str_repeat('A', 40), 'name' => 'world', 'data' => '[]',
        'created_at' => now(), 'updated_at' => now(),
    ];
    // The parts column is what the stats read, and save() is what normally fills it.
    $row += ['parts' => count(json_decode((string) $row['data'], true) ?: [])];

    return DB::table('maps')->insertGetId($row);
}

it('hides the admin area from guests and ordinary accounts', function () {
    $this->get('/admin')->assertNotFound();
    $this->getJson('/admin/overview')->assertNotFound();

    $this->actingAs(member())->get('/admin')->assertNotFound();
    $this->actingAs(member(['email' => 'b@example.com', 'is_admin' => true, 'banned_at' => now()]))
        ->get('/admin')->assertNotFound();
});

it('serves the dashboard and its overview to an admin', function () {
    $this->actingAs(admin())->get('/admin')->assertOk();

    $this->actingAs(admin())->getJson('/admin/overview')
        ->assertOk()
        ->assertJsonStructure(['me', 'totals' => ['users', 'maps', 'maps_anon', 'parts'], 'history', 'signups', 'created']);
});

it('lists users with their map counts and maps without their data', function () {
    $user = member();
    aMap(['user_id' => $user->id, 'name' => 'theirs']);

    $this->actingAs(admin())->getJson('/admin/users?q=Member')
        ->assertOk()
        ->assertJsonPath('total', 1)
        ->assertJsonPath('data.0.maps', 1);

    $body = $this->actingAs(admin())->getJson('/admin/maps')->assertOk()->json();
    expect($body['data'][0])->toHaveKey('bytes')->and($body['data'][0])->not->toHaveKey('data');
});

it('opens any map by id and deletes it', function () {
    $id = aMap(['data' => '[{"T":"Part"}]']);

    $this->actingAs(admin())->getJson("/admin/maps/$id")
        ->assertOk()
        ->assertJson(['name' => 'world', 'parts' => [['T' => 'Part']]]);

    $this->actingAs(admin())->deleteJson("/admin/maps/$id")->assertOk();
    expect(DB::table('maps')->count())->toBe(0);
});

it('bans an account, which blocks signing in', function () {
    $user = member();

    $this->actingAs(admin())->patchJson("/admin/users/{$user->id}", ['banned' => true])->assertOk();

    $this->postJson('/account/login', ['email' => $user->email, 'password' => 'correct horse'])
        ->assertStatus(403);

    $this->actingAs(admin())->patchJson("/admin/users/{$user->id}", ['banned' => false])->assertOk();
    $this->postJson('/account/login', ['email' => $user->email, 'password' => 'correct horse'])->assertOk();
});

it('ends the session of an account banned mid-session', function () {
    $user = member();
    $this->actingAs($user)->getJson('/account')->assertJson(['account' => ['email' => $user->email]]);

    $user->forceFill(['banned_at' => now()])->save();

    $this->actingAs($user)->getJson('/account')->assertJson(['account' => null]);
});

it('deletes an account together with its maps', function () {
    $user = member();
    aMap(['user_id' => $user->id]);

    $this->actingAs(admin())->deleteJson("/admin/users/{$user->id}")->assertOk();

    expect(User::find($user->id))->toBeNull()
        ->and(DB::table('maps')->count())->toBe(0);
});

it('refuses to ban or delete the admin doing it', function () {
    $boss = admin();

    $this->actingAs($boss)->patchJson("/admin/users/{$boss->id}", ['banned' => true])->assertStatus(422);
    $this->actingAs($boss)->deleteJson("/admin/users/{$boss->id}")->assertStatus(422);

    expect(User::find($boss->id)->banned_at)->toBeNull();
});

it('records one dated row per snapshot and updates it when run again', function () {
    member();
    aMap(['data' => '[{"T":"Part"},{"T":"Part"}]']);

    $this->artisan('stats:snapshot')->assertSuccessful();
    $this->artisan('stats:snapshot')->assertSuccessful();

    $rows = DB::table('daily_stats')->get();
    expect($rows)->toHaveCount(1);
    expect($rows[0]->users)->toBe(1)
        ->and($rows[0]->maps)->toBe(1)
        ->and($rows[0]->maps_anon)->toBe(1)
        ->and((int) $rows[0]->parts)->toBe(2);
});

it('grants and revokes admin from the console', function () {
    $user = member();

    $this->artisan('admin:grant', ['email' => $user->email])->assertSuccessful();
    expect($user->fresh()->is_admin)->toBeTrue();

    $this->artisan('admin:grant', ['email' => $user->email, '--revoke' => true])->assertSuccessful();
    expect($user->fresh()->is_admin)->toBeFalse();

    $this->artisan('admin:grant', ['email' => 'nobody@example.com'])->assertFailed();
});

it('shows the picture to a browser turned away from the admin area', function () {
    $r = $this->actingAs(member())->get('/admin');
    $r->assertNotFound();
    $r->assertSee('img/no-admin.webp');

    expect(is_file(public_path('img/no-admin.webp')))->toBeTrue();
});

it('keeps a json 404 for the admin api', function () {
    $this->actingAs(member())->getJson('/admin/maps/1')
        ->assertNotFound()
        ->assertHeader('content-type', 'application/json');
});

// The payload is cached, and a cached Collection used to come back as an incomplete
// class that encodes as a JSON object, which broke every chart on the second request.
it('serves the overview as json lists even from the cache', function () {
    // The suite's array store never serializes, so it cannot reproduce this at all.
    config()->set('cache.default', 'database');
    Cache::forget('admin_overview');
    $a = admin();
    User::factory()->create();
    asToken()->putJson('/api/maps/m', [PART])->assertOk();

    $this->actingAs($a)->getJson('/admin/overview')->assertOk();
    $second = $this->actingAs($a)->getJson('/admin/overview')->assertOk();

    $body = $second->json();
    expect($body['history'])->toBeArray()
        ->and($body['signups'])->toBeArray()
        ->and($body['created'])->toBeArray()
        ->and(array_is_list($body['signups']))->toBeTrue()
        ->and(array_is_list($body['created']))->toBeTrue();

    foreach ($body['created'] as $row) {
        expect($row)->toHaveKeys(['day', 'anon', 'account']);
    }
    foreach ($body['signups'] as $row) {
        expect($row)->toHaveKeys(['day', 'accounts']);
    }
});
