import assert from 'node:assert/strict';
import test from 'node:test';

import { MapDoc, MapError } from '../src/doc.js';
import { buildRoom } from '../src/build.js';

const room = () => buildRoom({
    x: 0, z: 0, width: 40, depth: 30, height: 14, palette: 'dungeon',
});

test('a whole room is one undoable action', () => {
    const doc = new MapDoc({});
    const result = doc.addParts('room', room(), { groupName: 'Hall' });

    assert.ok(result.added > 4);
    assert.equal(doc.parts.length, result.added);
    assert.equal(doc.groups.length, 1);

    doc.undo();
    assert.equal(doc.parts.length, 0);
    assert.equal(doc.groups.length, 0);

    doc.redo();
    assert.equal(doc.parts.length, result.added);
    assert.equal(doc.groups.length, 1);
});

test('a commit that fails validation leaves the map untouched', () => {
    const doc = new MapDoc({});
    doc.addParts('room', room());
    const before = doc.parts.length;
    const snapshot = doc.parts;

    assert.throws(() => doc.commit('bad', [
        { op: { t: 'remove', ids: [doc.parts[0]._id] } },
        { op: { t: 'add', items: [{ part: { _id: 'x', T: 'Part', P: [0, 0, 0], S: [1, 1, 1] } }] } },
    ]), MapError);

    assert.equal(doc.parts.length, before);
    assert.equal(doc.parts, snapshot);
});

const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => ({
    T: 'Part', P: [(from + i) * 4, 0, 0], S: [2, 2, 2], R: [0, 0, 0], C: 'ffffff',
}));

test('one oversized op is refused by the shared op validator', () => {
    const doc = new MapDoc({ maxParts: 10 });

    assert.throws(() => doc.addParts('too many', filler(11)), /too many parts/);
    assert.equal(doc.parts.length, 0);
});

test('ops that only bust the limit together are refused too', () => {
    const doc = new MapDoc({ maxParts: 10 });
    doc.addParts('first', filler(6));

    assert.throws(() => doc.addParts('second', filler(6, 6)), /over the 10 limit/);
    assert.equal(doc.parts.length, 6);
});

test('invalid part fields are rejected rather than written', () => {
    const doc = new MapDoc({});

    assert.throws(() => doc.addParts('bad material', [{
        T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0], M: 'Cheese',
    }]), MapError);
    assert.equal(doc.parts.length, 0);
});

test('removing parts prunes them out of folders', () => {
    const doc = new MapDoc({});
    const added = doc.addParts('room', room(), { groupName: 'Hall' });
    doc.removeParts('clear', added.ids.slice(0, 2));

    const ids = new Set(doc.parts.map((p) => p._id));
    for (const g of doc.groups) {
        for (const id of g.ids) assert.ok(ids.has(id));
    }
});

test('edits are published to a live sink, remote ops are not echoed back', () => {
    const sent = [];
    const doc = new MapDoc({ sink: { sendOp: (op) => sent.push(op), sendGroupOp() {}, sendGroups() {}, sendLights() {} } });

    doc.addParts('one', [{ T: 'Part', P: [0, 0, 0], S: [4, 1, 4], R: [0, 0, 0], C: 'ffffff' }]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].t, 'add');

    doc.applyRemote({ t: 'add', items: [{ part: { _id: 'remote1', T: 'Part', P: [9, 0, 0], S: [1, 1, 1], R: [0, 0, 0] } }] });
    assert.equal(sent.length, 1);
    assert.equal(doc.parts.length, 2);
    assert.equal(doc.historyLabels.length, 1);
});

test('undo of a live edit sends the inverse op', () => {
    const sent = [];
    const doc = new MapDoc({ sink: { sendOp: (op) => sent.push(op), sendGroupOp() {}, sendGroups() {}, sendLights() {} } });

    doc.addParts('one', [{ T: 'Part', P: [0, 0, 0], S: [4, 1, 4], R: [0, 0, 0], C: 'ffffff' }]);
    doc.undo();

    assert.equal(sent.length, 2);
    assert.equal(sent[1].t, 'remove');
    assert.equal(doc.parts.length, 0);
});
