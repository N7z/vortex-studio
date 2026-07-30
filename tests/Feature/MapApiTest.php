<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class MapApiTest extends TestCase
{
    use RefreshDatabase;

    private const PART = ['T' => 'Part', 'P' => [0, 0.5, 0], 'S' => [4, 1, 4], 'R' => [0, 0, 0], 'C' => 'a3a2a5', 'Tr' => 0];

    /**
     * Pin the anonymous identity, since queued cookies don't persist between
     * test requests. The value must be encrypted with the CookieValuePrefix
     * ourselves — withCookie() alone doesn't produce what EncryptCookies
     * accepts, and the middleware silently drops the cookie.
     */
    private function asToken(): static
    {
        $enc = app(\Illuminate\Contracts\Encryption\Encrypter::class);
        $value = \Illuminate\Cookie\CookieValuePrefix::create('studio_token', $enc->getKey()).str_repeat('A', 40);

        // withCredentials(): JSON test requests drop cookies without it.
        return $this->withCredentials()->disableCookieEncryption()->withCookie('studio_token', $enc->encrypt($value, false));
    }

    public function test_save_and_load_roundtrip(): void
    {
        $this->asToken()->putJson('/api/maps/mymap', [self::PART])->assertOk()->assertJson(['ok' => true]);
        $this->asToken()->getJson('/api/maps/mymap')->assertOk()->assertJson([self::PART]);
    }

    public function test_save_rejects_json_object_body(): void
    {
        $this->putJson('/api/maps/mymap', ['a' => 1])->assertStatus(400);
    }

    public function test_save_rejects_unknown_part_key(): void
    {
        $this->putJson('/api/maps/mymap', [self::PART + ['Evil' => 'x']])->assertStatus(400);
    }

    public function test_save_rejects_bad_vec3_and_color(): void
    {
        $this->putJson('/api/maps/a', [['P' => [0, 0], 'S' => [1, 1, 1], 'R' => [0, 0, 0], 'T' => 'Part']])->assertStatus(400);
        $this->putJson('/api/maps/b', [self::PART, ['C' => '<script>'] + self::PART])->assertStatus(400);
    }

    public function test_save_accepts_optional_fields(): void
    {
        $this->putJson('/api/maps/mymap', [
            self::PART + ['Shape' => 'Block', 'Sh' => 'Block', 'ItemId' => 3],
            self::PART + ['ItemId' => null],
        ])->assertOk();
    }

    public function test_map_quota_per_token(): void
    {
        $this->asToken()->putJson('/api/maps/first', [self::PART])->assertOk();
        $token = DB::table('maps')->value('token');

        for ($i = 0; $i < 49; $i++) {
            DB::table('maps')->insert([
                'token' => $token, 'name' => "m$i", 'data' => '[]',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $this->asToken()->putJson('/api/maps/one-too-many', [self::PART])->assertStatus(403);
        // overwriting an existing map is still allowed at the limit
        $this->asToken()->putJson('/api/maps/first', [self::PART])->assertOk();
    }

    public function test_stats_returns_json(): void
    {
        $this->getJson('/api/stats')->assertOk()
            ->assertJsonStructure(['maps', 'sessions', 'parts', 'examples', 'last_save']);
    }

    public function test_bad_map_name_rejected(): void
    {
        $this->getJson('/api/maps/bad!name')->assertStatus(400);   // invalid chars
        $this->getJson('/api/maps/..%2Fsecret')->assertStatus(404); // traversal never reaches the controller
    }
}
