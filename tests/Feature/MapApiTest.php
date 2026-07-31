<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

const PART = ['T' => 'Part', 'P' => [0, 0.5, 0], 'S' => [4, 1, 4], 'R' => [0, 0, 0], 'C' => 'a3a2a5', 'Tr' => 0];

it('round-trips a save and load', function () {
    asToken()->putJson('/api/maps/mymap', [PART])->assertOk()->assertJson(['ok' => true]);
    asToken()->getJson('/api/maps/mymap')->assertOk()->assertJson([PART]);
});

it('rejects a JSON object body', function () {
    $this->putJson('/api/maps/mymap', ['a' => 1])->assertStatus(400);
});

it('rejects an unknown part key', function () {
    $this->putJson('/api/maps/mymap', [PART + ['Evil' => 'x']])->assertStatus(400);
});

it('rejects a bad vec3 and color', function () {
    $this->putJson('/api/maps/a', [['P' => [0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0], 'T' => 'Part']])->assertStatus(400);
    $this->putJson('/api/maps/b', [PART, ['C' => '<script>'] + PART])->assertStatus(400);
});

it('accepts the optional fields', function () {
    $this->putJson('/api/maps/mymap', [
        PART + ['Shape' => 'Block', 'Sh' => 'Block', 'ItemId' => 3],
        PART + ['ItemId' => null],
    ])->assertOk();
});

it('enforces the map quota per token', function () {
    asToken()->putJson('/api/maps/first', [PART])->assertOk();
    $token = DB::table('maps')->value('token');

    for ($i = 0; $i < 49; $i++) {
        DB::table('maps')->insert([
            'token' => $token, 'name' => "m$i", 'data' => '[]',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    asToken()->putJson('/api/maps/one-too-many', [PART])->assertStatus(403);
    // overwriting an existing map is still allowed at the limit
    asToken()->putJson('/api/maps/first', [PART])->assertOk();
});

it('returns stats as JSON', function () {
    $this->getJson('/api/stats')->assertOk()
        ->assertJsonStructure(['maps', 'sessions', 'parts', 'examples', 'last_save']);
});

it('rejects a bad map name', function () {
    $this->getJson('/api/maps/bad!name')->assertStatus(400);   // invalid chars
    $this->getJson('/api/maps/..%2Fsecret')->assertStatus(404); // traversal never reaches the controller
});
