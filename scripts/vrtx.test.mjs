import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decompress as zstd } from 'fzstd';
import { decodeVrtx, encodeVrtx, isVrtx, VrtxError } from '../resources/js/studio/vrtx.js';

// The bincode payload inside a .vrtx, past the 5-byte header and the zstd frame.
const inner = (vrtx) => zstd(vrtx.subarray(5));

const bytesOf = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
// The same project in both formats: the .vrtx was written by the real Studio v0.2.1.
const sample = bytesOf('studio-0-2-project.vrtx');
const ref = JSON.parse(readFileSync(new URL('./fixtures/studio-0-2-project.json', import.meta.url), 'utf8'));
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

test('a real Studio .vrtx decodes to the same project as its JSON twin', () => {
    assert.ok(isVrtx(sample));
    const doc = decodeVrtx(sample);

    assert.equal(doc.project_id, ref.project_id);
    assert.equal(doc.parts.length, ref.parts.length);
    for (let i = 0; i < ref.parts.length; i += 1) {
        const a = doc.parts[i];
        const b = ref.parts[i];
        assert.equal(a.name, b.name);
        assert.equal(a.material, b.material);
        assert.ok(near(a.position.x, b.position.x) && near(a.position.y, b.position.y));
        assert.ok(near(a.color.r, b.color.r) && near(a.color.g, b.color.g));
        assert.equal(a.baseplate, b.baseplate);
        assert.equal(a.spawn_location, b.spawn_location);
        assert.deepEqual(a.textures, b.textures);
        assert.equal(a.point_light, null);
        assert.equal(a.spot_light, null);
    }
    assert.ok(near(doc.lighting.brightness, ref.lighting.brightness));
    assert.ok(near(doc.lighting.sun_illuminance, ref.lighting.sun_illuminance));
    // The sun direction is a field the JSON did not carry; it must be a unit quaternion.
    const q = doc.lighting.sun_rotation;
    assert.ok(near(Math.hypot(q.x, q.y, q.z, q.w), 1, 2e-3));
});

test('our encoder reproduces the exact bincode the Studio wrote', () => {
    // We store the zstd payload uncompressed (a valid raw-block frame), so the
    // container bytes differ from the Studio's compressed frame. What must match —
    // and does — is the bincode inside, the strongest evidence our file opens there.
    const doc = decodeVrtx(sample);
    const again = encodeVrtx(doc);
    assert.deepEqual([...inner(again)], [...inner(sample)]);
});

test('encode then decode round trips an arbitrary project', () => {
    const project = {
        project_id: 'a'.repeat(32),
        parts: [{
            name: 'Lamp',
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 4, y: 4, z: 4 },
            color: { r: 0.5, g: 0.25, b: 0.125, a: 1 },
            material: 'Wood',
            group: 0,
            cast_shadow: true,
            anchored: false,
            can_collide: true,
            spawn_location: false,
            baseplate: false,
            custom_appearance: false,
            truss: false,
            textures: [{ face: 'Top', kind: 'Studs' }],
            point_light: null,
            spot_light: {
                color: { r: 1, g: 1, b: 1, a: 1 },
                intensity: 800,
                range: 20,
                shadow_maps_enabled: true,
                angle: 0.6,
                face: 'Bottom',
            },
        }],
        lighting: {
            ambient_color: { r: 1, g: 1, b: 1, a: 1 },
            brightness: 2000,
            sun_color: { r: 1, g: 1, b: 1, a: 1 },
            sun_illuminance: 8000,
            sun_shadow_maps_enabled: true,
            sun_rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
        groups: [{ name: 'Fixtures', parent_group: null }],
    };
    const doc = decodeVrtx(encodeVrtx(project));
    assert.equal(doc.parts[0].material, 'Wood');
    assert.equal(doc.parts[0].group, 0);
    assert.equal(doc.parts[0].anchored, false);
    assert.equal(doc.parts[0].spot_light.face, 'Bottom');
    assert.ok(near(doc.parts[0].spot_light.angle, 0.6));
    assert.deepEqual(doc.parts[0].textures, [{ face: 'Top', kind: 'Studs' }]);
    assert.equal(doc.groups[0].name, 'Fixtures');
});

test('a non-vrtx buffer is rejected and not mistaken for one', () => {
    assert.equal(isVrtx(new Uint8Array([0x7b, 0x22, 0x70])), false); // starts with {"p
    assert.throws(() => decodeVrtx(new Uint8Array([1, 2, 3, 4, 5])), VrtxError);
});
