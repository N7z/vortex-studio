import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOp, invertOp, validPart, validateOp } from '../src/ops.js';
import { normaliseCode, randomCode, randomName } from '../src/names.js';

const part = (id, over = {}) => ({
    _id: id, T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0], ...over,
});

const roundTrip = (parts, op) => {
    const inverse = invertOp(parts, op);
    const after = applyOp(parts, op);
    return applyOp(after, inverse);
};

test('add appends and respects an explicit index', () => {
    const parts = [part('a'), part('b')];
    assert.deepEqual(
        applyOp(parts, { t: 'add', items: [{ part: part('c') }] }).map((p) => p._id),
        ['a', 'b', 'c'],
    );
    assert.deepEqual(
        applyOp(parts, { t: 'add', items: [{ part: part('c'), at: 1 }] }).map((p) => p._id),
        ['a', 'c', 'b'],
    );
});

test('re-applying an add moves the part to the position the op asks for', () => {
    const parts = [part('a'), part('b'), part('c')];
    const op = { t: 'add', items: [{ part: part('a') }] };
    const once = applyOp(parts, op);
    assert.deepEqual(once.map((p) => p._id), ['b', 'c', 'a']);
    assert.deepEqual(applyOp(once, op).map((p) => p._id), ['b', 'c', 'a']);
});

test('a multi-part add reconstructs the original order', () => {
    const parts = [part('a'), part('b'), part('c')];
    const removal = { t: 'remove', ids: ['a', 'c'] };
    const restored = roundTrip(parts, removal);
    assert.deepEqual(restored.map((p) => p._id), ['a', 'b', 'c']);
});

test('set writes fields and deletes unset ones', () => {
    const parts = [part('a', { C: 'ff0000', Tr: 0.5 })];
    const out = applyOp(parts, {
        t: 'set', items: [{ id: 'a', fields: { C: '00ff00' }, unset: ['Tr'] }],
    });
    assert.equal(out[0].C, '00ff00');
    assert.equal('Tr' in out[0], false);
});

test('set leaves untouched parts identical by reference', () => {
    const parts = [part('a'), part('b')];
    const out = applyOp(parts, { t: 'set', items: [{ id: 'a', fields: { C: 'abcdef' } }] });
    assert.equal(out[1], parts[1]);
});

test('inverting set restores both present and absent keys', () => {
    const parts = [part('a', { C: 'ff0000' })];
    const op = { t: 'set', items: [{ id: 'a', fields: { C: '00ff00', Tr: 0.25 } }] };
    assert.deepEqual(roundTrip(parts, op), parts);
});

test('inverting a transform restores every moved part', () => {
    const parts = [part('a', { P: [1, 2, 3] }), part('b', { P: [4, 5, 6] })];
    const op = {
        t: 'set',
        items: [
            { id: 'a', fields: { P: [9, 9, 9], R: [0, 90, 0] } },
            { id: 'b', fields: { P: [8, 8, 8], R: [0, 45, 0] } },
        ],
    };
    assert.deepEqual(roundTrip(parts, op), parts);
});

test('inverting add removes exactly what it added', () => {
    const parts = [part('a')];
    const op = { t: 'add', items: [{ part: part('b') }, { part: part('c') }] };
    assert.deepEqual(roundTrip(parts, op), parts);
});

test('inverting replace restores the whole document', () => {
    const parts = [part('a'), part('b')];
    const op = { t: 'replace', parts: [part('z')] };
    assert.deepEqual(roundTrip(parts, op), parts);
});

test('inverting a no-op yields null', () => {
    assert.equal(invertOp([part('a')], { t: 'remove', ids: ['nope'] }), null);
    assert.equal(invertOp([part('a')], { t: 'set', items: [{ id: 'nope', fields: { C: 'aaaaaa' } }] }), null);
    assert.equal(invertOp([part('a')], { t: 'add', items: [{ part: part('a') }] }), null);
});

test('validateOp accepts what the editor produces', () => {
    assert.equal(validateOp({ t: 'add', items: [{ part: part('a'), at: 0 }] }, 100), null);
    assert.equal(validateOp({ t: 'set', items: [{ id: 'a', fields: { P: [1, 2, 3] } }] }, 100), null);
    assert.equal(validateOp({ t: 'set', items: [{ id: 'a', fields: {}, unset: ['C'] }] }, 100), null);
    assert.equal(validateOp({ t: 'remove', ids: ['a'] }, 100), null);
    assert.equal(validateOp({ t: 'replace', parts: [part('a')] }, 100), null);
});

test('validateOp refuses malformed and oversized ops', () => {
    assert.ok(validateOp(null, 100));
    assert.ok(validateOp({ t: 'nope' }, 100));
    assert.ok(validateOp({ t: 'add', items: [] }, 100));
    assert.ok(validateOp({ t: 'add', items: [{ part: { _id: 'a' } }] }, 100));
    assert.ok(validateOp({ t: 'add', items: [{ part: part('a', { Junk: 1 }) }] }, 100));
    assert.ok(validateOp({ t: 'add', items: [{ part: part('a') }, { part: part('a') }] }, 100));
    assert.ok(validateOp({ t: 'replace', parts: [part('a'), part('a')] }, 100));
    assert.ok(validateOp({ t: 'replace', parts: [part('a'), part('b')] }, 1));
    assert.ok(validateOp({ t: 'set', items: [{ id: 'a', fields: { P: [1, 2] } }] }, 100));
    assert.ok(validateOp({ t: 'set', items: [{ id: 'a', fields: { C: 'zzzzzz' } }] }, 100));
    assert.ok(validateOp({ t: 'set', items: [{ id: 'a', fields: { Tr: 4 } }] }, 100));
    assert.ok(validateOp({ t: 'set', items: [{ id: 'a', fields: { _id: 'b' } }] }, 100));
    assert.ok(validateOp({ t: 'set', items: [{ id: 'a', unset: ['T'] }] }, 100));
});

test('validateOp allows a null ItemId but not a fractional one', () => {
    assert.equal(validateOp({ t: 'set', items: [{ id: 'a', fields: { ItemId: null } }] }, 100), null);
    assert.ok(validateOp({ t: 'set', items: [{ id: 'a', fields: { ItemId: 1.5 } }] }, 100));
});

test('room codes avoid the characters people mistype', () => {
    for (let i = 0; i < 200; i++) {
        assert.match(randomCode(), /^[ABCDEFGHJKMNPQRTUVWXY346789]{6}$/);
    }
});

test('normaliseCode matches what a user pastes', () => {
    assert.equal(normaliseCode(' ab-cd ef '), 'ABCDEF');
    assert.equal(normaliseCode(undefined), '');
});

test('randomName avoids names already in the room', () => {
    const taken = new Set(['Happy Capybara']);
    for (let i = 0; i < 200; i++) {
        assert.ok(!taken.has(randomName(taken)));
    }
});

test('a part can carry a point light and a spot light, within their ranges', () => {
    const lit = {
        _id: 'a',
        T: 'Part',
        P: [0, 0, 0],
        S: [4, 4, 4],
        R: [0, 0, 0],
        point_light: {
            color: 'ffe9c4', intensity: 60000, range: 40, shadow_maps_enabled: false,
        },
    };

    assert.equal(validPart(lit), true);
    assert.equal(validPart({
        ...lit,
        spot_light: {
            color: 'ffffff', intensity: 1000, range: 20, shadow_maps_enabled: true, angle: 35, face: 'Bottom',
        },
    }), true);

    // A spot needs the two things a point light has no use for.
    assert.equal(validPart({ ...lit, spot_light: lit.point_light }), false);
    assert.equal(validPart({
        ...lit,
        point_light: { ...lit.point_light, angle: 20 },
    }), false, 'a point light has no cone');
    assert.equal(validPart({ ...lit, point_light: { ...lit.point_light, range: -1 } }), false);
    assert.equal(validPart({ ...lit, point_light: { ...lit.point_light, color: 'white' } }), false);
    assert.equal(validPart({
        ...lit,
        spot_light: {
            color: 'ffffff', intensity: 1, range: 1, shadow_maps_enabled: true, angle: 35, face: 'Sideways',
        },
    }), false, 'a spot points at a face of the part it is on');
});

test('a part can be given a name, and an empty one is refused', () => {
    const part = {
        _id: 'a', T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0],
    };

    assert.equal(validPart({ ...part, N: 'Lamp post' }), true);
    assert.equal(validPart({ ...part, N: '' }), false, 'a part with no name goes by its type');
    assert.equal(validPart({ ...part, N: 'x'.repeat(65) }), false);
    assert.equal(validPart({ ...part, N: 7 }), false);
});
