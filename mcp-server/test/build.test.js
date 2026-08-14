import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCorridor, buildRoom, buildStairs, buildTerrain, carveAll, carvePlan, scatterProps,
    subtractBox,
} from '../src/build.js';
import { PROPS, buildProp } from '../src/catalog.js';
import {
    boundsOf, overlaps, partBounds, partsInRegion, regionBounds,
} from '../src/geom.js';

const withIds = (parts) => parts.map((p, i) => ({ _id: `p${i}`, ...p }));

test('a room encloses its inside on all four sides', () => {
    const parts = buildRoom({
        x: 0, z: 0, width: 40, depth: 30, height: 14,
    });
    const b = boundsOf(parts);

    assert.equal(b.minX, 0);
    assert.equal(b.maxX, 40);
    assert.equal(b.minZ, 0);
    assert.equal(b.maxZ, 30);

    const walls = parts.filter((p) => p.P[1] > 0);
    for (const side of [
        { x: 0, z: 0, width: 40, depth: 2 },
        { x: 0, z: 28, width: 40, depth: 2 },
        { x: 0, z: 2, width: 2, depth: 26 },
        { x: 38, z: 2, width: 2, depth: 26 },
    ]) {
        const on = partsInRegion(walls, { ...side, y: 0, height: 14 });
        assert.ok(on.length, `no wall along ${JSON.stringify(side)}`);
    }
});

test('a doorway leaves a real hole in the wall and a lintel above it', () => {
    const parts = buildRoom({
        x: 0,
        z: 0,
        width: 40,
        depth: 30,
        height: 14,
        doorways: [{ side: 'north', offset: 20, width: 8, height: 10 }],
    });

    const gap = {
        minX: 17, maxX: 23, minY: 1, maxY: 9, minZ: 0.1, maxZ: 1.9,
    };
    const blocking = parts.filter((p) => overlaps(partBounds(p), gap));
    assert.equal(blocking.length, 0, 'the doorway is blocked');

    const above = {
        minX: 17, maxX: 23, minY: 11, maxY: 13, minZ: 0.1, maxZ: 1.9,
    };
    assert.ok(parts.some((p) => overlaps(partBounds(p), above)), 'no lintel above the doorway');
});

test('a room refuses sizes and heights that cannot be played', () => {
    assert.throws(() => buildRoom({
        x: 0, z: 0, width: 4, depth: 4, height: 14, wallThickness: 2,
    }), /no inside/);

    assert.throws(() => buildRoom({
        x: 0, z: 0, width: 40, depth: 30, height: 4,
    }), /too low/);

    assert.throws(() => buildRoom({
        x: 0,
        z: 0,
        width: 40,
        depth: 30,
        height: 14,
        doorways: [{ side: 'north', offset: 20, width: 8, height: 3 }],
    }), /too short/);

    assert.throws(() => buildRoom({
        x: 0,
        z: 0,
        width: 40,
        depth: 30,
        height: 14,
        doorways: [{ side: 'north', offset: 39, width: 8 }],
    }), /does not fit/);
});

test('subtracting a box splits a wall into the pieces around the hole', () => {
    const wall = {
        _id: 'w', T: 'Part', P: [20, 7, 1], S: [40, 14, 2], R: [0, 0, 0],
    };
    const pieces = subtractBox(wall, {
        minX: 16, maxX: 24, minY: 0, maxY: 10, minZ: 0, maxZ: 2,
    });

    assert.ok(pieces.length >= 3);
    const volume = pieces.reduce((n, p) => n + p.S[0] * p.S[1] * p.S[2], 0);
    assert.equal(Math.round(volume), 40 * 14 * 2 - 8 * 10 * 2);

    for (const p of pieces) {
        assert.ok(!overlaps(partBounds(p), {
            minX: 16.1, maxX: 23.9, minY: 0.1, maxY: 9.9, minZ: 0.1, maxZ: 1.9,
        }));
    }
});

test('a rotated part is reported instead of being cut wrongly', () => {
    const wall = {
        _id: 'w', T: 'Part', P: [0, 5, 0], S: [10, 10, 2], R: [0, 30, 0],
    };
    assert.equal(subtractBox(wall, {
        minX: -1, maxX: 1, minY: 0, maxY: 4, minZ: -2, maxZ: 2,
    }), null);

    const plan = carvePlan([wall], {
        x: -1, y: 0, z: -2, width: 2, height: 4, depth: 4,
    });
    assert.deepEqual(plan.skipped, ['w']);
    assert.equal(plan.removed.length, 0);
});

test('carving twice through the same wall keeps both holes', () => {
    const wall = withIds([{
        T: 'Part', P: [20, 7, 1], S: [40, 14, 2], R: [0, 0, 0], C: 'ffffff',
    }]);
    const plan = carveAll(wall, [
        {
            x: 4, y: 0, z: 0, width: 6, height: 10, depth: 2,
        },
        {
            x: 30, y: 0, z: 0, width: 6, height: 10, depth: 2,
        },
    ]);

    assert.deepEqual(plan.removed, ['p0']);
    const rebuilt = withIds(plan.added);
    for (const hole of [
        { minX: 4.1, maxX: 9.9, minY: 0.1, maxY: 9.9, minZ: 0.1, maxZ: 1.9 },
        { minX: 30.1, maxX: 35.9, minY: 0.1, maxY: 9.9, minZ: 0.1, maxZ: 1.9 },
    ]) {
        assert.equal(rebuilt.filter((p) => overlaps(partBounds(p), hole)).length, 0);
    }
});

test('an L corridor produces both legs and they meet', () => {
    const parts = buildCorridor({
        from: [0, 0], to: [40, 30], width: 8, height: 12, bend: 'x',
    });
    const floors = parts.filter((p) => p.P[1] < 0);

    const walkable = (x, z) => floors.some((p) => {
        const b = partBounds(p);

        return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    });

    assert.ok(walkable(2, 0), 'no floor at the start');
    assert.ok(walkable(40, 0), 'no floor at the bend');
    assert.ok(walkable(40, 28), 'no floor at the end');
    assert.ok(!walkable(2, 28), 'the corridor should not cut the corner');
});

test('stairs refuse a rise the character cannot walk up', () => {
    assert.throws(() => buildStairs({
        from: [0, 0, 0], to: [20, 20, 0], steps: 2,
    }), /above the 2/);

    const good = buildStairs({ from: [0, 0, 0], to: [20, 10, 0], steps: 10 });
    assert.equal(good.length, 10);

    assert.throws(() => buildStairs({ from: [0, 0, 0], to: [10, 10, 10] }), /not diagonally/);
});

test('terrain covers the footprint and stays under the block budget', () => {
    const parts = buildTerrain({
        x: 0, z: 0, width: 80, depth: 80, cell: 8, amplitude: 6, seed: 5,
    });
    assert.equal(parts.length, 100);

    assert.throws(() => buildTerrain({
        x: 0, z: 0, width: 2000, depth: 2000, cell: 4,
    }), /4000/);
});

test('scattered props do not overlap each other', () => {
    const region = {
        x: 0, y: 0, z: 0, width: 80, height: 20, depth: 80,
    };
    const { placed } = scatterProps({
        region, props: ['crate', 'barrel'], count: 15, seed: 9, spacing: 2,
    }, []);

    assert.ok(placed.length > 5);
    const boxes = placed.map((p) => boundsOf(p.parts));
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            assert.ok(!overlaps(boxes[i], boxes[j]), `props ${i} and ${j} overlap`);
        }
    }
});

test('scattering avoids the geometry already in the area', () => {
    const region = {
        x: 0, y: 0, z: 0, width: 40, height: 20, depth: 40,
    };
    const blocker = withIds([{
        T: 'Part', P: [20, 5, 20], S: [30, 10, 30], R: [0, 0, 0], C: 'ffffff',
    }]);
    const { placed } = scatterProps({
        region, props: ['crate'], count: 10, seed: 4, spacing: 1,
    }, blocker);

    const box = partBounds(blocker[0]);
    for (const p of placed) {
        assert.ok(!overlaps(boundsOf(p.parts), box));
    }
});

test('every prop builds valid geometry standing on the floor it was given', () => {
    for (const id of Object.keys(PROPS)) {
        const parts = buildProp(id, {
            x: 0, y: 10, z: 0, yaw: 90,
        });
        assert.ok(parts.length, `${id} built nothing`);
        for (const p of parts) {
            assert.equal(p.P.length, 3);
            assert.ok(p.S.every((v) => v > 0), `${id} has a zero size part`);
        }
    }
});

test('a prop yawed by 90 degrees keeps its footprint area', () => {
    const flat = boundsOf(buildProp('bookshelf', { x: 0, y: 0, z: 0, yaw: 0 }));
    const turned = boundsOf(buildProp('bookshelf', { x: 0, y: 0, z: 0, yaw: 90 }));

    const areaA = (flat.maxX - flat.minX) * (flat.maxZ - flat.minZ);
    const areaB = (turned.maxX - turned.minX) * (turned.maxZ - turned.minZ);
    assert.ok(Math.abs(areaA - areaB) < 0.01);
    assert.ok(Math.abs((flat.maxX - flat.minX) - (turned.maxZ - turned.minZ)) < 0.01);
});

test('regions and part bounds agree on what is inside', () => {
    const region = {
        x: 0, y: 0, z: 0, width: 10, height: 10, depth: 10,
    };
    const box = regionBounds(region);
    assert.deepEqual([box.minX, box.maxX], [0, 10]);

    const inside = withIds([{ T: 'Part', P: [5, 5, 5], S: [2, 2, 2], R: [0, 0, 0], C: 'ffffff' }]);
    assert.equal(partsInRegion(inside, region, 'contain').length, 1);

    const straddling = withIds([{ T: 'Part', P: [10, 5, 5], S: [4, 2, 2], R: [0, 0, 0], C: 'ffffff' }]);
    assert.equal(partsInRegion(straddling, region, 'contain').length, 0);
    assert.equal(partsInRegion(straddling, region, 'overlap').length, 1);
});
