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

const round = (doc) => JSON.parse(JSON.stringify(
    doc, (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v),
));

test('a project the Studio wrote is recognised as one', { skip: !have }, () => {
    assert.equal(isProject(official), true);
});

test('a project the Studio wrote survives import and export unchanged', { skip: !have }, () => {
    const read = fromProject(official);
    const parts = read.parts.map(withNewId);
    const groups = read.groups.map((g) => newGroup(g.name, g.slots.map((i) => parts[i]._id)));
    const out = toProject(parts, groups, read.projectId, read.lighting);

    // The reference file predates both the rig becoming one object and a part being able to hold a
    // light, so it carries a list of suns and no light keys on its parts. Everything else has to
    // come back byte for byte.
    const { lighting, ...rest } = out;
    const { lights, ...officialRest } = official;
    rest.parts = rest.parts.map(({ point_light, spot_light, ...p }) => {
        assert.equal(point_light, null);
        assert.equal(spot_light, null);

        return p;
    });
    assert.deepEqual(round(rest), round(officialRest));
});

test('a list of suns is folded into the one sun the rig now has', { skip: !have }, () => {
    const read = fromProject(official);

    assert.equal(read.lighting.sun_illuminance, official.lights[0].illuminance);
    assert.equal(read.lighting.sun_shadow_maps_enabled, official.lights[0].shadows_enabled !== false);

    const out = toProject(read.parts.map(withNewId), [], read.projectId, read.lighting);
    assert.deepEqual(Object.keys(out.lighting).sort(), [
        'ambient_color', 'brightness', 'sun_color', 'sun_illuminance', 'sun_rotation',
        'sun_shadow_maps_enabled',
    ]);
    assert.equal(out.lighting.sun_illuminance, DEFAULT_ILLUMINANCE);
    assert.equal(Object.keys(out.lighting.ambient_color).sort().join(''), 'abgr');
    assert.equal(out.lights, undefined, 'the list is gone');
});

test('a group is an index into groups, and ungrouped is null', { skip: !have }, () => {
    const read = fromProject(official);
    const parts = read.parts.map(withNewId);
    const groups = read.groups.map((g) => newGroup(g.name, g.slots.map((i) => parts[i]._id)));
    const out = toProject(parts, groups, read.projectId, read.lighting);

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

test('a group inside a group survives export and import', () => {
    const parts = [
        { _id: 'p1', T: 'Part', P: [0, 0, 0], S: [4, 1, 2] },
        { _id: 'p2', T: 'Part', P: [8, 0, 0], S: [4, 1, 2] },
    ];
    const outer = newGroup('Outer', []);
    const inner = { ...newGroup('Inner', ['p1', 'p2']), parent: outer.id };

    const doc = toProject(parts, [outer, inner], '0'.repeat(32), []);
    assert.deepEqual(doc.groups, [
        { name: 'Outer', parent_group: null },
        { name: 'Inner', parent_group: 0 },
    ]);

    const read = fromProject(doc);
    const back = read.groups;
    assert.equal(back.length, 2, 'the empty outer folder is kept because it holds the inner one');
    assert.equal(back[0].name, 'Outer');
    assert.equal(back[0].parentAt, null);
    assert.deepEqual(back[0].slots, []);
    assert.equal(back[1].name, 'Inner');
    assert.equal(back[1].parentAt, 0);
    assert.deepEqual(back[1].slots, [0, 1]);
});

test('a parent index pointing nowhere is dropped, not obeyed', () => {
    const parts = [{ _id: 'p1', T: 'Part', P: [0, 0, 0], S: [4, 1, 2] }];
    const doc = toProject(parts, [newGroup('Solo', ['p1'])], '0'.repeat(32), []);
    doc.groups[0].parent_group = 7;

    assert.equal(fromProject(doc).groups[0].parentAt, null);
});

test('a light on a part survives export and import, cone and all', () => {
    const lamp = {
        _id: 'p1',
        T: 'Part',
        P: [0, 10, 0],
        S: [2, 2, 2],
        R: [0, 0, 0],
        point_light: {
            color: 'ffe9c4', intensity: 60000, range: 40, shadow_maps_enabled: false,
        },
        spot_light: {
            color: 'ffffff', intensity: 12000, range: 25, shadow_maps_enabled: true, angle: 30, face: 'Bottom',
        },
    };

    const doc = toProject([lamp], [], '0'.repeat(32), null);
    const [out] = doc.parts;
    assert.equal(out.point_light.range, 40);
    assert.equal(out.point_light.shadow_maps_enabled, false);
    assert.ok(Math.abs(out.spot_light.angle - (30 * Math.PI) / 180) < 1e-4, 'the cone goes out in radians');
    assert.equal(out.spot_light.face, 'Bottom');

    const back = fromProject(doc).parts[0];
    assert.deepEqual(back.point_light, lamp.point_light);
    assert.deepEqual(back.spot_light, lamp.spot_light);
});

test('a part with no light carries no light keys', () => {
    const [out] = toProject(
        [{ _id: 'p1', T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0] }], [], '0'.repeat(32), null,
    ).parts;

    assert.equal(out.point_light, null);
    assert.equal(out.spot_light, null);
    assert.equal('point_light' in fromProject({ parts: [out] }).parts[0], false);
});
