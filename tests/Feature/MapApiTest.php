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

it('accepts a gzipped body', function () {
    $body = gzencode(json_encode(['parts' => [PART], 'groups' => [], 'version' => null]));

    asToken()->call(
        'PUT', '/api/maps/zipped', [], tokenCookie(), [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_BODY_ENCODING' => 'gzip',
        ], $body
    )->assertOk()->assertJson(['ok' => true]);

    asToken()->getJson('/api/maps/zipped')->assertOk()->assertJson(['parts' => [PART]]);
});

it('refuses a body that says gzip and is not', function () {
    asToken()->call(
        'PUT', '/api/maps/broken', [], tokenCookie(), [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_BODY_ENCODING' => 'gzip',
        ], 'this is not gzip'
    )->assertStatus(400);
});

it('gzips a map far past what PHP would take uncompressed', function () {
    $parts = [];
    for ($i = 0; $i < 20000; $i++) {
        $parts[] = ['_id' => str_pad((string) $i, 10, 'a', STR_PAD_LEFT)] + PART;
    }
    $plain = json_encode(['parts' => $parts, 'groups' => [], 'version' => null]);
    $body = gzencode($plain);
    expect(strlen($body))->toBeLessThan(strlen($plain) / 4);

    asToken()->call(
        'PUT', '/api/maps/huge', [], tokenCookie(), [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_BODY_ENCODING' => 'gzip',
        ], $body
    )->assertOk();

    expect(DB::table('maps')->where('name', 'huge')->value('parts'))->toBe(20000);
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

it('exempts nothing from CSRF', function () {
    expect(app(ValidateCsrfToken::class)->getExcludedPaths())->toBe([]);
});

it('returns stats as JSON', function () {
    $this->getJson('/api/stats')->assertOk()
        ->assertJsonStructure(['maps', 'sessions', 'parts', 'last_save']);
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

    $this->actingAs(User::factory()->create())
        ->putJson('/api/maps/huge', ['parts' => $parts])->assertStatus(400);
});

it('stores and serves a map thumbnail', function () {
    Storage::fake();
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();

    $webp = 'RIFF'.pack('V', 20).'WEBPVP8 '.str_repeat("\0", 12);
    asToken()->call('PUT', '/api/maps/shot/thumb', [], tokenCookie(), [], ['CONTENT_TYPE' => 'image/webp'], $webp)
        ->assertOk();

    $key = DB::table('maps')->where('name', 'shot')->value('thumb_key');
    expect($key)->toMatch('/^[a-f0-9]{32}$/');
    Storage::disk()->assertExists("thumbs/$key.webp");

    $listed = asToken()->getJson('/api/maps')->json('mine.0.thumb');
    expect($listed)->toContain("thumbs/$key.webp");

    $this->get("/api/thumbs/$key.webp")->assertOk()->assertHeader('content-type', 'image/webp');
});

it('refuses a thumbnail that is not a webp', function () {
    Storage::fake();
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();

    asToken()->call('PUT', '/api/maps/shot/thumb', [], tokenCookie(), [], ['CONTENT_TYPE' => 'image/webp'], '<?php echo 1;')
        ->assertStatus(400);
});

it('lists no thumbnail before one is stored', function () {
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();
    expect(asToken()->getJson('/api/maps')->json('mine.0.thumb'))->toBeNull();
});

it('gives every thumbnail an unguessable name and drops the old one', function () {
    Storage::fake();
    asToken()->putJson('/api/maps/shot', [PART])->assertOk();
    $webp = 'RIFF'.pack('V', 20).'WEBPVP8 '.str_repeat(' ', 12);
    $put = fn () => asToken()->call('PUT', '/api/maps/shot/thumb', [], tokenCookie(), [], ['CONTENT_TYPE' => 'image/webp'], $webp);

    $put()->assertOk();
    $first = DB::table('maps')->where('name', 'shot')->value('thumb_key');
    $put()->assertOk();
    $second = DB::table('maps')->where('name', 'shot')->value('thumb_key');

    expect($second)->not->toBe($first);
    Storage::disk()->assertMissing("thumbs/$first.webp");
    Storage::disk()->assertExists("thumbs/$second.webp");

    $id = DB::table('maps')->where('name', 'shot')->value('id');
    $this->get("/api/thumbs/$id.webp")->assertNotFound();
});

const FULL_PART = [
    '_id' => 'aaa', 'T' => 'Part', 'P' => [0, 0, 0], 'S' => [200, 2, 200], 'R' => [0, 0, 0],
    'C' => '7d7d85', 'Tr' => 0, 'Shape' => 'Block',
    'M' => 'Metal', 'Cs' => false, 'An' => false, 'Cc' => false, 'Bp' => true,
    'Tx' => ['Top' => 'Studs', 'Bottom' => 'Inlets'],
];

const LIGHT = [
    '_id' => 'l1', 'N' => 'Sun', 'P' => [80, 160, 60], 'R' => [-69.44, 25.09, 17.53],
    'C' => 'ffffff', 'I' => 10000, 'Sd' => true,
];

const PROJECT_ID = 'c32819ed4aa4a42511cefa9d974e3ce3';

it('round-trips every property the studio document carries', function () {
    asToken()->putJson('/api/maps/parity', [
        'parts' => [FULL_PART], 'groups' => [], 'lights' => [LIGHT], 'project_id' => PROJECT_ID,
    ])->assertOk();

    asToken()->getJson('/api/maps/parity')->assertOk()->assertJson([
        'parts' => [FULL_PART],
        'lights' => [LIGHT],
        'project_id' => PROJECT_ID,
    ]);
});

it('refuses a part property it does not know', function (array $bad) {
    asToken()->putJson('/api/maps/bad', ['parts' => [array_merge(FULL_PART, $bad)], 'groups' => []])
        ->assertStatus(400);
})->with([
    'unknown material' => [['M' => 'Gold']],
    'unknown face' => [['Tx' => ['Sideways' => 'Studs']]],
    'unknown texture' => [['Tx' => ['Top' => 'Bricks']]],
    'a toggle that is not a boolean' => [['Cs' => 'yes']],
    'textures as the document list, not our map' => [['Tx' => [['face' => 'Top', 'kind' => 'Studs']]]],
]);

it('refuses a light it cannot store', function (array $bad) {
    asToken()->putJson('/api/maps/bad', ['parts' => [], 'groups' => [], 'lights' => [array_merge(LIGHT, $bad)]])
        ->assertStatus(400);
})->with([
    'no shadow flag' => [['Sd' => null]],
    'illuminance past the ceiling' => [['I' => 1e9]],
    'a colour that is not six hex digits' => [['C' => 'white']],
    'an empty name' => [['N' => '']],
]);

it('refuses two lights sharing an id', function () {
    asToken()->putJson('/api/maps/bad', ['parts' => [], 'groups' => [], 'lights' => [LIGHT, LIGHT]])
        ->assertStatus(400);
});

it('refuses a project id that is not 32 hex characters', function () {
    asToken()->putJson('/api/maps/bad', ['parts' => [], 'groups' => [], 'project_id' => 'nope'])
        ->assertStatus(400);
});

it('leaves stored lights and project id alone when a save omits them', function () {
    asToken()->putJson('/api/maps/keep', [
        'parts' => [FULL_PART], 'groups' => [], 'lights' => [LIGHT], 'project_id' => PROJECT_ID,
    ])->assertOk();

    asToken()->putJson('/api/maps/keep', [FULL_PART])->assertOk();

    asToken()->getJson('/api/maps/keep')->assertOk()
        ->assertJson(['lights' => [LIGHT], 'project_id' => PROJECT_ID]);
});

it('still takes a map with none of the new properties', function () {
    asToken()->putJson('/api/maps/old', [PART])->assertOk();
    asToken()->getJson('/api/maps/old')->assertOk()
        ->assertJson(['parts' => [PART], 'lights' => [], 'project_id' => null]);
});
