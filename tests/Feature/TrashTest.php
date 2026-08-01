<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

const XPART = ['T' => 'Part', 'P' => [0, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];

beforeEach(fn () => Storage::fake());

it('puts a deleted map in the trash and back', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => [XPART]])->assertOk();
    $id = DB::table('maps')->where('name', 'm')->value('id');

    $this->actingAs($a)->deleteJson('/api/maps/m')->assertOk();
    $this->actingAs($a)->getJson('/api/maps')->assertOk()->assertJsonCount(0, 'mine');
    $this->actingAs($a)->getJson('/api/maps/m')->assertStatus(404);

    $this->actingAs($a)->getJson('/api/maps/trash')->assertOk()
        ->assertJsonCount(1, 'trash')
        ->assertJsonPath('trash.0.name', 'm');

    $this->actingAs($a)->postJson("/api/trash/$id/restore")->assertOk()->assertJson(['name' => 'm']);
    $this->actingAs($a)->getJson('/api/maps/m')->assertOk();
});

/** The name is free the moment the map is trashed, so restoring must not collide. */
it('renames a restored map when its name was taken meanwhile', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => [XPART]])->assertOk();
    $id = DB::table('maps')->where('name', 'm')->value('id');

    $this->actingAs($a)->deleteJson('/api/maps/m')->assertOk();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => [XPART]])->assertOk();

    $this->actingAs($a)->postJson("/api/trash/$id/restore")->assertOk()->assertJson(['name' => 'm-2']);
    expect(DB::table('maps')->whereNull('deleted_at')->pluck('name')->sort()->values()->all())
        ->toBe(['m', 'm-2']);
});

it('shows nobody else the trash', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => [XPART]])->assertOk();
    $id = DB::table('maps')->where('name', 'm')->value('id');
    $this->actingAs($a)->deleteJson('/api/maps/m')->assertOk();

    $this->actingAs($b)->getJson('/api/maps/trash')->assertOk()->assertJsonCount(0, 'trash');
    $this->actingAs($b)->postJson("/api/trash/$id/restore")->assertStatus(404);
    $this->actingAs($b)->deleteJson("/api/trash/$id")->assertStatus(404);
});

/** Deleting a team map is the owner's alone, so putting one back is too. */
it('keeps a team editor out of the team trash', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = $this->actingAs($a)->postJson('/api/teams', ['name' => 'Crew'])->assertCreated()->json('id');
    $this->actingAs($a)->postJson("/api/teams/$team/members", ['email' => $b->email, 'role' => 'editor'])
        ->assertOk();

    $this->actingAs($a)->putJson("/api/maps/m?team=$team", ['parts' => [XPART]])->assertOk();
    $id = DB::table('maps')->where('name', 'm')->value('id');
    $this->actingAs($a)->deleteJson("/api/maps/m?team=$team")->assertOk();

    $this->actingAs($b)->getJson('/api/maps/trash')->assertOk()->assertJsonCount(0, 'trash');
    $this->actingAs($b)->postJson("/api/trash/$id/restore")->assertStatus(404);
    $this->actingAs($a)->getJson('/api/maps/trash')->assertOk()->assertJsonCount(1, 'trash');
});

it('refuses to restore past the map limit', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/gone', ['parts' => [XPART]])->assertOk();
    $id = DB::table('maps')->where('name', 'gone')->value('id');
    $this->actingAs($a)->deleteJson('/api/maps/gone')->assertOk();

    for ($i = 0; $i < 50; $i++) {
        DB::table('maps')->insert([
            'token' => str_repeat('A', 40), 'name' => "f$i", 'data' => '[]', 'parts' => 0,
            'user_id' => $a->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    $this->actingAs($a)->postJson("/api/trash/$id/restore")->assertStatus(403);
});

it('records who deleted what', function () {
    $a = User::factory()->create();
    $this->actingAs($a)->putJson('/api/maps/m', ['parts' => [XPART]])->assertOk();
    $this->actingAs($a)->deleteJson('/api/maps/m')->assertOk();

    $row = DB::table('audit_log')->where('action', 'map.delete')->first();

    expect($row)->not->toBeNull()
        ->and((int) $row->user_id)->toBe($a->id)
        ->and($row->subject_type)->toBe('map')
        ->and(json_decode($row->meta, true)['name'])->toBe('m');
});

it('records team membership changes', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $team = $this->actingAs($a)->postJson('/api/teams', ['name' => 'Crew'])->assertCreated()->json('id');
    $this->actingAs($a)->postJson("/api/teams/$team/members", ['email' => $b->email, 'role' => 'editor'])
        ->assertOk();
    $this->actingAs($a)->patchJson("/api/teams/$team/members/{$b->id}", ['role' => 'viewer'])->assertOk();
    $this->actingAs($a)->deleteJson("/api/teams/$team/members/{$b->id}")->assertOk();

    expect(DB::table('audit_log')->orderBy('id')->pluck('action')->all())->toBe([
        'team.create', 'team.member_add', 'team.member_role', 'team.member_remove',
    ]);
});
