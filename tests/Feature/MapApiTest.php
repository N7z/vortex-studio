<?php

use App\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

const PART = ['T' => 'Part', 'P' => [0, 0.5, 0], 'S' => [4, 1, 4], 'R' => [0, 0, 0], 'C' => 'a3a2a5', 'Tr' => 0];

it('round-trips a save and load', function () {
    asToken()->putJson('/api/maps/mymap', [PART])->assertOk()->assertJson(['ok' => true]);
    asToken()->getJson('/api/maps/mymap')->assertOk()->assertJson(['parts' => [PART], 'groups' => []]);
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

it('lets two accounts save the same name from one browser', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();

    asToken()->actingAs($a)->putJson('/api/maps/foo', [PART])->assertOk();
    asToken()->actingAs($b)->putJson('/api/maps/foo', [PART])->assertOk();

    expect(DB::table('maps')->where('name', 'foo')->count())->toBe(2);
});

it('keeps created_at across saves', function () {
    asToken()->putJson('/api/maps/mymap', [PART])->assertOk();
    $created = DB::table('maps')->value('created_at');

    DB::table('maps')->update(['created_at' => '2020-01-01 00:00:00']);
    asToken()->putJson('/api/maps/mymap', [PART, PART])->assertOk();

    expect(DB::table('maps')->value('created_at'))->toBe('2020-01-01 00:00:00')
        ->and(DB::table('maps')->value('parts'))->toBe(2)
        ->and($created)->not->toBeNull();
});

it('counts parts in stats without reading the map data', function () {
    asToken()->putJson('/api/maps/mymap', [PART, PART, PART])->assertOk();

    $this->getJson('/api/stats')->assertOk()->assertJson(['parts' => 3, 'maps' => 1]);
});

// ValidateCsrfToken always passes under tests, so the write routes being covered
// can only be asserted through the exemption list.
it('exempts nothing from CSRF', function () {
    expect(app(ValidateCsrfToken::class)->getExcludedPaths())->toBe([]);
});

it('returns stats as JSON', function () {
    $this->getJson('/api/stats')->assertOk()
        ->assertJsonStructure(['maps', 'sessions', 'parts', 'examples', 'last_save']);
});

it('rejects a bad map name', function () {
    $this->getJson('/api/maps/bad!name')->assertStatus(400);   // invalid chars
    $this->getJson('/api/maps/..%2Fsecret')->assertStatus(404); // traversal never reaches the controller
});

it('accepts a part id and keeps it', function () {
    asToken()->putJson('/api/maps/mymap', [PART + ['_id' => 'abc123def4']])->assertOk();
    asToken()->getJson('/api/maps/mymap')->assertOk()->assertJson(['parts' => [PART + ['_id' => 'abc123def4']]]);
});

it('still accepts a part with no id', function () {
    $this->putJson('/api/maps/mymap', [PART])->assertOk();
});

it('rejects an over-long part id', function () {
    $this->putJson('/api/maps/mymap', [PART + ['_id' => str_repeat('a', 65)]])->assertStatus(400);
});

it('rejects a part id with bad characters', function () {
    $this->putJson('/api/maps/mymap', [PART + ['_id' => 'no spaces']])->assertStatus(400);
});

it('rejects duplicate part ids', function () {
    $this->putJson('/api/maps/mymap', [PART + ['_id' => 'dup'], PART + ['_id' => 'dup']])->assertStatus(400);
});

const IPART = ['_id' => 'p1', 'T' => 'Part', 'P' => [0, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];
const IPART2 = ['_id' => 'p2', 'T' => 'Part', 'P' => [1, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];

it('round-trips groups in the envelope', function () {
    asToken()->putJson('/api/maps/m', [
        'parts' => [IPART, IPART2],
        'groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['p1', 'p2']]],
    ])->assertOk();

    asToken()->getJson('/api/maps/m')->assertOk()->assertJson([
        'parts' => [IPART, IPART2],
        'groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['p1', 'p2']]],
    ]);
});

it('leaves stored groups alone when an old client sends a bare array', function () {
    asToken()->putJson('/api/maps/m', [
        'parts' => [IPART],
        'groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['p1']]],
    ])->assertOk();

    asToken()->putJson('/api/maps/m', [IPART])->assertOk();

    asToken()->getJson('/api/maps/m')->assertOk()
        ->assertJson(['groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['p1']]]]);
});

it('rejects a group naming an unknown part', function () {
    $this->putJson('/api/maps/m', [
        'parts' => [IPART],
        'groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['nope']]],
    ])->assertStatus(400);
});

it('rejects a part in two groups', function () {
    $this->putJson('/api/maps/m', [
        'parts' => [IPART],
        'groups' => [
            ['id' => 'g1', 'name' => 'A', 'ids' => ['p1']],
            ['id' => 'g2', 'name' => 'B', 'ids' => ['p1']],
        ],
    ])->assertStatus(400);
});

it('rejects too many groups', function () {
    $groups = [];
    for ($i = 0; $i <= 2000; $i++) {
        $groups[] = ['id' => "g$i", 'name' => 'G', 'ids' => ['p1']];
    }
    $this->putJson('/api/maps/m', ['parts' => [IPART], 'groups' => $groups])->assertStatus(400);
});

it('rejects a group with an empty id list and an unknown key', function () {
    $this->putJson('/api/maps/m', [
        'parts' => [IPART],
        'groups' => [['id' => 'g1', 'name' => 'A', 'ids' => []]],
    ])->assertStatus(400);

    $this->putJson('/api/maps/m', [
        'parts' => [IPART],
        'groups' => [['id' => 'g1', 'name' => 'A', 'ids' => ['p1'], 'evil' => 1]],
    ])->assertStatus(400);
});

it('clears groups when an empty list is sent', function () {
    asToken()->putJson('/api/maps/m', [
        'parts' => [IPART],
        'groups' => [['id' => 'g1', 'name' => 'Wall', 'ids' => ['p1']]],
    ])->assertOk();

    asToken()->putJson('/api/maps/m', ['parts' => [IPART], 'groups' => []])->assertOk();
    asToken()->getJson('/api/maps/m')->assertOk()->assertJson(['groups' => []]);
});

it('accepts a map far larger than the old twenty thousand part cap', function () {
    $parts = [];
    for ($i = 0; $i < 30000; $i++) {
        $parts[] = ['_id' => "p$i", 'T' => 'Part', 'P' => [$i, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];
    }

    asToken()->putJson('/api/maps/big', ['parts' => $parts])->assertOk();
    expect(DB::table('maps')->where('name', 'big')->value('parts'))->toBe(30000);
});

it('still refuses a map past the new cap', function () {
    $parts = [];
    for ($i = 0; $i < 60001; $i++) {
        $parts[] = ['T' => 'Part', 'P' => [0, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];
    }

    $this->putJson('/api/maps/toobig', ['parts' => $parts])->assertStatus(400);
});

it('lets an admin save past the part and byte caps', function () {
    $boss = User::factory()->create();
    $boss->forceFill(['is_admin' => true])->save();

    $parts = [];
    for ($i = 0; $i < 70000; $i++) {
        $parts[] = ['_id' => "p$i", 'T' => 'Part', 'P' => [$i, 0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0]];
    }

    $this->actingAs($boss)->putJson('/api/maps/huge', ['parts' => $parts])->assertOk();
    expect(DB::table('maps')->where('name', 'huge')->value('parts'))->toBe(70000);

    // The same body from an ordinary account is still refused.
    $this->actingAs(User::factory()->create())
        ->putJson('/api/maps/huge', ['parts' => $parts])->assertStatus(400);
});

it('stores and serves a map thumbnail', function () {
    Storage::fake('local');
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();

    $webp = 'RIFF'.pack('V', 20).'WEBPVP8 '.str_repeat("\0", 12);
    asToken()->call('PUT', '/api/maps/shot/thumb', [], tokenCookie(), [], ['CONTENT_TYPE' => 'image/webp'], $webp)
        ->assertOk();

    $id = DB::table('maps')->where('name', 'shot')->value('id');
    Storage::disk('local')->assertExists("thumbs/$id.webp");

    // A disk with public URLs serves it directly; one without falls back to the app.
    $listed = asToken()->getJson('/api/maps')->json('mine.0.thumb');
    expect($listed)->toContain("thumbs/$id.webp")->toContain('?v=');

    $this->get("/api/thumbs/$id.webp")->assertOk()->assertHeader('content-type', 'image/webp');
});

it('refuses a thumbnail that is not a webp', function () {
    Storage::fake('local');
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();

    asToken()->call('PUT', '/api/maps/shot/thumb', [], tokenCookie(), [], ['CONTENT_TYPE' => 'image/webp'], '<?php echo 1;')
        ->assertStatus(400);
});

it('lists no thumbnail before one is stored', function () {
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();
    expect(asToken()->getJson('/api/maps')->json('mine.0.thumb'))->toBeNull();
});
