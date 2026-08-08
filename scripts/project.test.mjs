// The official Studio project format, checked against a file the desktop Studio
// wrote itself rather than against our own idea of it. VortexStuff is a sibling
// checkout; without it these skip rather than fail, so CI on this repo alone stays
// green.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { fromProject, isProject, toProject } from '../resources/js/studio/vortexProject.js';
import { newGroup } from '../resources/js/studio/groups.js';
import { withNewId } from '../resources/js/studio/ops.js';
import { DEFAULT_ILLUMINANCE } from '../resources/js/studio/lighting.js';

const REFERENCE = new URL(
    '../../VortexStuff/maps/studio-minimal-project.json', import.meta.url,
).pathname;

const have = existsSync(REFERENCE);
const official = have ? JSON.parse(readFileSync(REFERENCE, 'utf8')) : null;

// Floats go out through a quaternion and come back through Euler degrees, so they
// are compared at the precision the format itself is written to.
const round = (doc) => JSON.parse(JSON.stringify(
    doc, (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v),
));

test('a project the Studio wrote is recognised as one', { skip: !have }, () => {
    assert.equal(isProject(official), true);
});

test('a project the Studio wrote survives import and export unchanged', { skip: !have }, () => {
    const read = fromProject(official);
    // Rebuild what the editor would be holding, ids and all.
    const parts = read.parts.map(withNewId);
    const groups = read.groups.map((g) => newGroup(g.name, g.slots.map((i) => parts[i]._id)));

    assert.deepEqual(round(toProject(parts, groups, read.projectId, read.lights)), round(official));
});

test('a group is an index into groups, and ungrouped is null', { skip: !have }, () => {
    const read = fromProject(official);
    const parts = read.parts.map(withNewId);
    const groups = read.groups.map((g) => newGroup(g.name, g.slots.map((i) => parts[i]._id)));
    const out = toProject(parts, groups, read.projectId, read.lights);

    // A string in either place is a type error to serde and rejects the whole file.
    for (const g of out.groups) {
        assert.deepEqual(Object.keys(g).sort(), ['name', 'parent_group']);
        assert.equal(g.parent_group, null);
    }
    for (const p of out.parts) {
        assert.ok(p.group === null || Number.isInteger(p.group), `bad group ${p.group}`);
    }
    assert.equal(out.parts[0].group, null);
    assert.equal(out.parts[2].group, 0);
});

test('the light default matches what the Studio writes', { skip: !have }, () => {
    assert.equal(official.lights[0].illuminance, DEFAULT_ILLUMINANCE);
});

test('the slab exports as a Baseplate and keeps its faces', { skip: !have }, () => {
    const slab = fromProject(official).parts[0];
    assert.equal(slab.Bp, true);
    assert.deepEqual(slab.Tx, { Top: 'Studs', Bottom: 'Inlets' });

    const [out] = toProject([{ ...slab, _id: 'a' }], [], 'a'.repeat(32), []).parts;
    assert.equal(out.name, 'Baseplate');
    assert.equal(out.baseplate, true);
});

test('every part property the format carries survives a round trip', () => {
    const part = {
        _id: 'a',
        T: 'Part',
        P: [1, 2, 3],
        S: [4, 2, 4],
        R: [0, 45, 0],
        C: 'ff8800',
        Tr: 0.25,
        Shape: 'Block',
        M: 'Metal',
        Cs: false,
        An: false,
        Cc: false,
        Bp: true,
        Tx: { Top: 'Studs', Front: 'Inlets' },
    };
    const doc = toProject([part], [], 'a'.repeat(32), []);
    const [back] = fromProject(doc).parts;

    for (const k of ['M', 'Cs', 'An', 'Cc', 'Bp', 'Tx', 'C', 'Tr', 'T', 'P', 'S']) {
        assert.deepEqual(back[k], part[k], `${k} did not survive`);
    }
    // Degrees out through a quaternion and back are not bit-exact.
    assert.ok(Math.abs(back.R[1] - 45) < 1e-3, `rotation drifted to ${back.R[1]}`);
});

test('a default is written as an absent key, not an explicit one', () => {
    const plain = {
        _id: 'a', T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0], C: 'a3a2a5', Tr: 0, Shape: 'Block',
    };
    const [back] = fromProject(toProject([plain], [], 'a'.repeat(32), [])).parts;

    for (const k of ['M', 'Cs', 'An', 'Cc', 'Bp', 'Tx']) {
        assert.ok(!(k in back), `${k} should be absent when it is the default`);
    }
});
