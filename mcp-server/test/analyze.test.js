import assert from 'node:assert/strict';
import test from 'node:test';

import {
    density, findOverlaps, findUnsupported, statistics, surfaceField, surfaces, validate,
    walkability,
} from '../src/analyze.js';
import { MapDoc } from '../src/doc.js';
import { buildRoom } from '../src/build.js';

let seq = 0;
const part = (over) => ({
    _id: `p${seq++}`, T: 'Part', P: [0, 0, 0], S: [4, 1, 4], R: [0, 0, 0], C: 'ffffff', ...over,
});

const slab = (x, y, z, w = 40, d = 40) => part({ P: [x, y, z], S: [w, 2, d] });

const spawn = (x, y, z) => part({
    T: 'SpawnLocation', P: [x, y, z], S: [8, 1, 8], C: '4db84b',
});

test('two separated platforms are reported as unreachable from each other', () => {
    const parts = [
        slab(0, 0, 0),
        spawn(0, 1.5, 0),
        slab(400, 0, 0),
    ];
    const result = walkability(parts, { cell: 4 });

    assert.equal(result.islands.length, 2);
    assert.equal(result.unreachable.length, 1);
    assert.ok(result.unreachable[0].bounds.minX > 300);
});

test('platforms within a jump of each other count as connected', () => {
    const parts = [
        slab(0, 0, 0, 40, 40),
        spawn(0, 1.5, 0),
        slab(42, 4, 0, 40, 40),
    ];
    const result = walkability(parts, { cell: 2 });
    assert.equal(result.unreachable.length, 0);

    const strict = walkability(parts, { cell: 2, allowJump: false });
    assert.equal(strict.unreachable.length, 1);
});

test('a roofed room exposes both its inside floor and its roof as separate levels', () => {
    const parts = [
        slab(0, 0, 0),
        spawn(0, 1.5, 0),
        part({ P: [0, 4, 0], S: [40, 2, 40] }),
    ];
    const field = surfaceField(parts, { cell: 4 });
    const found = surfaces(field, 5);

    const inside = found.filter((s) => s.y === 1);
    const roof = found.filter((s) => s.y === 5);

    assert.ok(inside.length, 'the floor under the roof was not seen at all');
    assert.ok(inside.every((s) => !s.standable), 'a 2 unit crawlspace should not be walkable');
    assert.ok(roof.length && roof.every((s) => s.standable), 'the roof should be walkable');
});

test('a room with proper headroom is walkable inside', () => {
    const parts = [
        slab(0, 0, 0),
        spawn(0, 1.5, 0),
        part({ P: [0, 16, 0], S: [40, 2, 40] }),
    ];
    const found = surfaces(surfaceField(parts, { cell: 4 }), 5);

    assert.ok(found.filter((s) => s.y <= 2).some((s) => s.standable));
});

test('overlapping parts are found and scored by how much they intersect', () => {
    const hits = findOverlaps([
        part({ P: [0, 0, 0], S: [10, 10, 10] }),
        part({ P: [5, 0, 0], S: [10, 10, 10] }),
        part({ P: [100, 0, 0], S: [10, 10, 10] }),
    ]);

    assert.equal(hits.length, 1);
    assert.equal(hits[0].volume, 500);
    assert.equal(hits[0].fractionOfSmaller, 0.5);
});

test('a part touching another face to face is not an overlap', () => {
    const hits = findOverlaps([
        part({ P: [0, 0, 0], S: [10, 10, 10] }),
        part({ P: [10, 0, 0], S: [10, 10, 10] }),
    ]);

    assert.equal(hits.length, 0);
});

test('an anchored part hanging in the air is reported', () => {
    const floating = findUnsupported([
        slab(0, 0, 0),
        part({ P: [0, 50, 0], S: [4, 4, 4] }),
        part({ P: [0, 2, 0], S: [4, 2, 4] }),
    ]);

    assert.equal(floating.length, 1);
    assert.equal(floating[0].bottomY, 48);
});

test('validate refuses a map with no spawn and passes one with a good spawn', () => {
    const bare = new MapDoc({ parts: [slab(0, 0, 0)], groups: [], lights: [] });
    const first = validate(bare);
    assert.equal(first.ok, false);
    assert.ok(first.issues.some((i) => i.code === 'no_spawn'));

    const good = new MapDoc({
        parts: [slab(0, 0, 0), spawn(0, 1.5, 0)],
        groups: [],
        lights: [],
    });
    const second = validate(good);
    assert.equal(second.ok, true, JSON.stringify(second.issues));
});

test('validate notices a spawn buried under solid geometry', () => {
    const doc = new MapDoc({
        parts: [slab(0, 0, 0), spawn(0, 1.5, 0), part({ P: [0, 4, 0], S: [8, 4, 8] })],
        groups: [],
        lights: [],
    });
    const result = validate(doc);

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'spawn_blocked'));
});

test('validate reports unreachable areas as a warning, not a failure', () => {
    const doc = new MapDoc({
        parts: [slab(0, 0, 0), spawn(0, 1.5, 0), slab(400, 0, 0)],
        groups: [],
        lights: [],
    });
    const result = validate(doc);

    assert.equal(result.ok, true);
    assert.ok(result.issues.some((i) => i.code === 'unreachable'));
});

test('validate flags a folder pointing at parts that are gone', () => {
    const doc = new MapDoc({
        parts: [slab(0, 0, 0), spawn(0, 1.5, 0)],
        groups: [{ id: 'g1', name: 'Ghost', ids: ['missing'] }],
        lights: [],
    });

    assert.ok(validate(doc).issues.some((i) => i.code === 'stale_group'));
});

test('statistics describe what the map is made of', () => {
    const parts = [
        ...buildRoom({
            x: 0, z: 0, width: 40, depth: 30, height: 14, palette: 'dungeon',
        }).map((p) => part(p)),
        spawn(20, 1.5, 15),
    ];
    const stats = statistics(parts, [], []);

    assert.equal(stats.parts, parts.length);
    assert.equal(stats.spawns, 1);
    assert.ok(stats.bounds.width >= 40);
    assert.ok(stats.topColors.length > 0);
});

test('density separates a crowded area from a bare one', () => {
    const parts = [slab(0, 0, 0, 200, 200)];
    for (let i = 0; i < 30; i++) {
        parts.push(part({ P: [-80 + (i % 6) * 4, 2, -80 + Math.floor(i / 6) * 4], S: [2, 2, 2] }));
    }

    const result = density(parts, { cell: 4, window: 40 });
    const sorted = [...result.tiles].sort((a, b) => b.parts - a.parts);

    assert.ok(sorted[0].parts > 0);
    assert.ok(sorted.at(-1).parts === 0);
});

test('a huge area asks for a bigger cell instead of blowing up', () => {
    assert.throws(
        () => walkability([slab(0, 0, 0, 20000, 20000)], { cell: 1 }),
        /Pass cell >=/,
    );
});
