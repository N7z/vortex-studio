<?php

use App\Models\User;
use App\Support\Audit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

function aTemplate(string $name = 'tee.png'): UploadedFile
{
    return UploadedFile::fake()->createWithContent($name, base64_decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ));
}

it('keeps the uploaded template with the audit row', function () {
    Storage::fake(config('filesystems.audit'));

    $this->post('/api/clothing/log', [
        'slot' => 'shirt',
        'name' => 'tee.png',
        'width' => 585,
        'height' => 559,
        'image' => aTemplate('tee.png'),
    ])->assertOk();

    $meta = DB::table('audit_log')->where('action', 'clothing.upload')->value('meta');
    $path = Audit::imageOf($meta);

    expect($path)->not->toBeNull();
    Audit::images()->assertExists($path);
});

it('drops the stored image when the audit row ages out', function () {
    Storage::fake(config('filesystems.audit'));

    $this->post('/api/clothing/log', [
        'slot' => 'pants',
        'image' => aTemplate('legs.png'),
    ])->assertOk();

    $path = Audit::imageOf(DB::table('audit_log')->value('meta'));
    DB::table('audit_log')->update(['created_at' => now()->subDays(Audit::KEEP_DAYS + 1)]);

    expect(Audit::purgeOld())->toBe(1);
    Audit::images()->assertMissing($path);
});

it('only lets admins pull an audit image', function () {
    Storage::fake(config('filesystems.audit'));

    $this->post('/api/clothing/log', [
        'slot' => 'shirt',
        'image' => aTemplate('tee.png'),
    ])->assertOk();
    $id = DB::table('audit_log')->value('id');

    $this->get("/admin/audit/$id/image")->assertNotFound();

    $boss = User::create(['name' => 'Boss', 'email' => 'boss@example.com', 'password' => 'correct horse']);
    $boss->forceFill(['is_admin' => true])->save();

    $this->actingAs($boss)->get("/admin/audit/$id/image")->assertOk();
});
