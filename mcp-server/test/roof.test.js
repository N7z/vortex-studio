import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRoof } from '../src/build.js';
import { boundsOf, partBounds, rotationMatrix } from '../src/geom.js';

const footprint = {
    x: -15, z: -12, width: 30, depth: 24, y: 14,
};

// The world direction the part's own +Z (or +X) edge runs in, which is what decides
// whether a pair of slabs makes a peak or a valley.
// `side` is +1 for the slab on the positive side of the ridge, which runs downhill along its own
// +axis, and -1 for its mirror, which runs downhill along its own -axis.
const downhill = (part, axis, side) => {
    const m = rotationMatrix(...(part.R ?? [0, 0, 0]));
    const local = axis === 'z' ? [m[2], m[5], m[8]] : [m[0], m[3], m[6]];

    return local.map((v) => v * side);
};

test('the two slabs meet at a ridge instead of forming a valley', () => {
    const roof = buildRoof({ ...footprint, pitch: 33.69, gables: false });

    assert.equal(roof.ridge, 'x');
    assert.equal(roof.parts.length, 2);
    assert.ok(Math.abs(roof.rise - 8) < 0.05, `rise ${roof.rise}`);
    assert.ok(Math.abs(roof.ridgeY - 22) < 0.05, `ridge at ${roof.ridgeY}`);

    const [positive, negative] = roof.parts;
    assert.ok(positive.P[2] > 0 && negative.P[2] < 0, 'one slab each side of the ridge');
    // Each slab slopes away from the ridge: its downhill edge points away from centre and down.
    assert.ok(downhill(positive, 'z', 1)[1] < 0 && downhill(positive, 'z', 1)[2] > 0);
    assert.ok(downhill(negative, 'z', -1)[1] < 0 && downhill(negative, 'z', -1)[2] < 0);

    const b = boundsOf(roof.parts);
    assert.ok(Math.abs(b.maxY - 22) < 0.7, `peak at ${b.maxY}`);
    assert.ok(b.minX < footprint.x && b.maxX > footprint.x + footprint.width, 'eaves overhang');
});

test('the ridge follows the long side unless told otherwise', () => {
    assert.equal(buildRoof({ ...footprint }).ridge, 'x');
    assert.equal(buildRoof({
        ...footprint, width: 24, depth: 30,
    }).ridge, 'z');

    const forced = buildRoof({ ...footprint, ridge: 'z', gables: false });
    assert.equal(forced.ridge, 'z');
    const [positive, negative] = forced.parts;
    assert.ok(positive.P[0] > 0 && negative.P[0] < 0);
    assert.ok(downhill(positive, 'x', 1)[1] < 0 && downhill(positive, 'x', 1)[0] > 0, 'slopes down toward +X');
    assert.ok(downhill(negative, 'x', -1)[1] < 0 && downhill(negative, 'x', -1)[0] < 0);
});

test('the gable fillers sit in the roof plane and reach the walls below', () => {
    const roof = buildRoof({ ...footprint, pitch: 33.69, gableThickness: 2 });

    assert.equal(roof.parts.length, 6);
    const gables = roof.parts.slice(2);
    for (const g of gables) {
        const b = partBounds(g);
        assert.ok(b.maxY <= roof.ridgeY + 0.2, 'nothing pokes through the ridge');
        assert.ok(b.minY < footprint.y, 'the spare depth is buried in the wall');
        assert.ok(Math.abs(Math.abs(g.P[0]) - 14) < 0.01, 'one at each end, inside the wall line');
    }

    const peak = gables.filter((g) => partBounds(g).maxY > roof.ridgeY - 0.5);
    assert.equal(peak.length, 4, 'every filler reaches the ridge');
});

test('a pitch outside roof territory is refused', () => {
    assert.throws(() => buildRoof({ ...footprint, pitch: 85 }), /not a roof/);
});
