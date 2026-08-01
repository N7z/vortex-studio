<?php

use App\Http\Controllers\MapController;
use App\Models\User;
use App\Support\MapHistory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

const HPART = ['T' => 'Part', 'P' => [0, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];

beforeEach(fn () => Storage::fake());

function hteam(User $owner): int
{
    return test()->actingAs($owner)->postJson('/api/teams', ['name' => 'Crew'])
        ->assertCreated()->json('id');
}

function hparts(int $n): array
{
    return array_fill(0, $n, HPART);
}

/** A save on its own leaves nothing to go back to: the first save has no pre-image. */
it('keeps no version for the very first save', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => [HPART]])->assertOk();

    $this->actingAs($a)->getJson('/api/maps/m/history')->assertOk()->assertJsonCount(0, 'versions');
});

it('snapshots the pre-image when a different editor saves', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = hteam($a);
    test()->actingAs($a)->postJson("/api/teams/$team/members", ['email' => $b->email, 'role' => 'editor'])
        ->assertOk();

    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => hparts(3)])->assertOk();
    // The first overwrite is always kept: until it happens there is nothing to go back to.
    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => hparts(4)])->assertOk();
    // Same editor, seconds later, one part changed: not worth its own copy.
    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => hparts(5)])->assertOk();
    $this->actingAs($b)->putJson("/api/maps/m?team=$team", ['parts' => hparts(6)])->assertOk();

    $v = $this->actingAs($a)->getJson("/api/maps/m/history?team=$team")->assertOk()->json('versions');

    // Newest first: what B replaced, then what A's first overwrite replaced.
    expect($v)->toHaveCount(2)
        ->and(array_column($v, 'parts'))->toBe([5, 3])
        ->and($v[0]['by'])->toBe($a->name);
});

it('never stores the same content twice', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(2)])->assertOk();

    $this->actingAs($a)->postJson('/api/maps/m/history')->assertOk();
    $this->actingAs($a)->postJson('/api/maps/m/history')->assertOk();

    expect(DB::table('map_versions')->count())->toBe(1);
});

it('restores a version and can undo the restore', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(5)])->assertOk();
    $pin = $this->actingAs($a)->postJson('/api/maps/m/history')->assertOk()->json('id');

    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(1)])->assertOk();
    expect(DB::table('maps')->where('name', 'm')->value('parts'))->toBe(1);

    $this->actingAs($a)->postJson("/api/maps/m/history/$pin/restore")
        ->assertOk()->assertJson(['parts' => 5]);
    expect(DB::table('maps')->where('name', 'm')->value('parts'))->toBe(5);

    // The restore snapshotted what it replaced, so putting the wrong one back is undoable.
    $before = collect($this->actingAs($a)->getJson('/api/maps/m/history')->json('versions'))
        ->firstWhere('parts', 1);
    expect($before)->not->toBeNull();

    $this->actingAs($a)->postJson("/api/maps/m/history/{$before['id']}/restore")->assertOk();
    expect(DB::table('maps')->where('name', 'm')->value('parts'))->toBe(1);
});

it('refuses a version of a map the caller cannot see', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(3)])->assertOk();
    $pin = $this->actingAs($a)->postJson('/api/maps/m/history')->assertOk()->json('id');

    $this->actingAs($b)->getJson("/api/maps/m/history/$pin")->assertStatus(404);
    $this->actingAs($b)->postJson("/api/maps/m/history/$pin/restore")->assertStatus(404);
});

it('lets a viewer read the history but not restore it', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = hteam($a);
    test()->actingAs($a)->postJson("/api/teams/$team/members", ['email' => $b->email, 'role' => 'viewer'])
        ->assertOk();

    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => hparts(3)])->assertOk();
    $pin = $this->actingAs($a)->postJson("/api/maps/m/history?team=$team")->assertOk()->json('id');

    $this->actingAs($b)->getJson("/api/maps/m/history?team=$team")->assertOk();
    $this->actingAs($b)->postJson("/api/maps/m/history/$pin/restore?team=$team")->assertStatus(403);
});

it('asks before a save that throws most of a team map away', function () {
    $a = User::factory()->create();
    $team = hteam($a);
    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => hparts(400)])->assertOk();

    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => hparts(5)])
        ->assertStatus(422)
        ->assertJson(['error' => 'destructive', 'was' => 400, 'now' => 5]);
    expect(DB::table('maps')->where('name', 'm')->value('parts'))->toBe(400);

    $this->actingAs($a)
        ->withHeader('X-Confirm-Destructive', '1')
        ->putJson("/api/maps/m?team=$team", ['parts' => hparts(5)])
        ->assertOk();

    expect(DB::table('maps')->where('name', 'm')->value('parts'))->toBe(5)
        ->and(DB::table('audit_log')->where('action', 'map.save_destructive')->count())->toBe(1)
        // The confirmed wreck is what created the copy to come back to.
        ->and(DB::table('map_versions')->where('reason', 'destructive')->value('parts'))->toBe(400);
});

it('leaves a personal map alone: clearing your own work is ordinary', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(400)])->assertOk();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(1)])->assertOk();

    expect(DB::table('maps')->where('name', 'm')->value('parts'))->toBe(1);
});

it('keeps a pinned version through retention and drops an old ordinary one', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(3)])->assertOk();
    $map = DB::table('maps')->where('name', 'm')->first();

    $old = now()->subDays(90);
    DB::table('map_versions')->insert([
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'manual', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('a', 64), 'storage_key' => 'k1', 'created_at' => $old],
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'save', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('b', 64), 'storage_key' => 'k2', 'created_at' => $old],
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'save', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('c', 64), 'storage_key' => 'k3', 'created_at' => $old],
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'save', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('d', 64), 'storage_key' => 'k4', 'created_at' => $old],
    ]);

    MapHistory::prune((int) $map->id);

    // The three newest are kept whatever their age, and the pinned one always is.
    expect(DB::table('map_versions')->where('reason', 'manual')->count())->toBe(1)
        ->and(DB::table('map_versions')->count())->toBe(4);

    DB::table('map_versions')->insert([
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'save', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('e', 64), 'storage_key' => 'k5', 'created_at' => now()],
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'save', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('f', 64), 'storage_key' => 'k6', 'created_at' => now()],
        ['map_id' => $map->id, 'version' => 1, 'reason' => 'save', 'parts' => 1, 'bytes' => 1,
            'hash' => str_repeat('0', 64), 'storage_key' => 'k7', 'created_at' => now()],
    ]);
    MapHistory::prune((int) $map->id);

    expect(DB::table('map_versions')->where('reason', 'manual')->count())->toBe(1)
        ->and(DB::table('map_versions')->where('storage_key', 'k2')->exists())->toBeFalse();
});

it('drops every snapshot when the map is purged for good', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => hparts(3)])->assertOk();
    $this->actingAs($a)->postJson('/api/maps/m/history')->assertOk();

    $id = DB::table('maps')->where('name', 'm')->value('id');
    $this->actingAs($a)->deleteJson('/api/maps/m')->assertOk();
    $this->actingAs($a)->deleteJson("/api/trash/$id")->assertOk();

    expect(DB::table('map_versions')->count())->toBe(0)
        ->and(DB::table('maps')->count())->toBe(0);
});

it('purges only trash older than the window', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/old', ['parts' => [HPART]])->assertOk();
    $this->actingAs($a)->putJson('/api/maps/new', ['parts' => [HPART]])->assertOk();
    $this->actingAs($a)->deleteJson('/api/maps/old')->assertOk();
    $this->actingAs($a)->deleteJson('/api/maps/new')->assertOk();

    DB::table('maps')->where('name', 'old')
        ->update(['deleted_at' => now()->subDays(MapController::TRASH_DAYS + 1)]);

    expect(MapController::purge())->toBe(1)
        ->and(DB::table('maps')->pluck('name')->all())->toBe(['new']);
});
