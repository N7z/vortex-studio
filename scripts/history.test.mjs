import assert from 'node:assert/strict';
import test from 'node:test';

import { COALESCE_MS, continues, editKey, lightingKey } from '../resources/js/studio/history.js';
import { partLightOf, partLightRef } from '../resources/js/studio/lighting.js';

const dragging = (ids, field) => editKey({
    t: 'set', items: ids.map((id) => ({ id, fields: { [field]: 1 } })),
});

test('one drag on one field is one undo step, and a pause ends it', () => {
    const key = dragging(['a'], 'Tr');
    const last = { key, at: 1000 };

    assert.equal(continues(last, key, 1000 + COALESCE_MS - 1), true, 'still the same move');
    assert.equal(continues(last, key, 1000 + COALESCE_MS + 1), false, 'the hand paused');
});

test('a different field, part or selection starts its own step', () => {
    const last = { key: dragging(['a'], 'Tr'), at: 1000 };

    assert.equal(continues(last, dragging(['a'], 'Tr'), 1100), true);
    assert.equal(continues(last, dragging(['a'], 'C'), 1100), false, 'another field');
    assert.equal(continues(last, dragging(['b'], 'Tr'), 1100), false, 'another part');
    assert.equal(continues(last, dragging(['a', 'b'], 'Tr'), 1100), false, 'another selection');
    assert.equal(continues({ key: null, at: 0 }, null, 1100), false, 'nothing to carry on from');
});

test('taking a property off is not the same move as setting it', () => {
    const set = editKey({ t: 'set', items: [{ id: 'a', fields: { point_light: {} } }] });
    const off = editKey({ t: 'set', items: [{ id: 'a', unset: ['point_light'] }] });

    assert.notEqual(set, off);
});

test('only a set can be carried on: adding and removing parts always stand alone', () => {
    assert.equal(editKey({ t: 'add', items: [] }), null);
    assert.equal(editKey({ t: 'remove', ids: ['a'] }), null);
    assert.equal(editKey(null), null);
});

test('the rig coalesces per property too', () => {
    assert.equal(lightingKey({ brightness: 1 }), lightingKey({ brightness: 2 }));
    assert.notEqual(lightingKey({ brightness: 1 }), lightingKey({ ambient_color: 'fff000' }));
});

test('a light is selected through the part that holds it', () => {
    const ref = partLightRef('part-1', 'spot');

    assert.deepEqual(partLightOf(ref), { kind: 'spot', partId: 'part-1' });
    assert.equal(partLightOf('part-1'), null, 'a plain part id is not a light');
    assert.equal(partLightOf('light:sun'), null, 'and neither is the rig');

    // Gathering several lights only makes sense while they are the same kind.
    const picked = ['a', 'b'].map((id) => partLightRef(id, 'point'));
    const mixed = [...picked, partLightRef('c', 'spot')];
    const sameKind = mixed.filter((r) => partLightOf(r).kind === 'point');
    assert.deepEqual(sameKind, picked);
});
