import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    DEFAULT_LIGHTING, DEFAULT_POINT_LIGHT, DEFAULT_SPOT_LIGHT, FACE_DIRECTION, cleanLighting,
} from '../resources/js/studio/lighting.js';

// The rule the renderer walks the scene by: an invisible object takes everything under it with it.
// This is why a light on a part cannot be a child of the part's mesh — an opaque part is drawn
// through a batch, so its own mesh is left invisible and parked out of the way.
const litBy = (scene) => {
    const found = [];
    const walk = (o) => {
        if (o.visible === false) return;
        if (o.isLight) found.push(o);
        for (const kid of o.children) walk(kid);
    };
    walk(scene);

    return found;
};

const batchedPart = () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.visible = false;
    mesh.position.set(10, 4, -6);

    return mesh;
};

test('a light parented to a batched part never reaches the renderer', () => {
    const scene = new THREE.Scene();
    const parked = new THREE.Group();
    parked.visible = false;
    scene.add(parked);

    const mesh = batchedPart();
    parked.add(mesh);
    mesh.add(new THREE.PointLight(0xffffff, 1));

    assert.equal(litBy(scene).length, 0, 'this is the trap: the light is silently dropped');
});

test('a light kept beside the parts, following one, does reach it', () => {
    const scene = new THREE.Scene();
    const parked = new THREE.Group();
    parked.visible = false;
    scene.add(parked);
    const hosts = new THREE.Group();
    scene.add(hosts);

    const mesh = batchedPart();
    parked.add(mesh);

    const light = new THREE.PointLight(0xffffff, 1);
    hosts.add(light);
    mesh.updateWorldMatrix(true, false);
    light.position.setFromMatrixPosition(mesh.matrixWorld);

    const found = litBy(scene);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].position.toArray(), [10, 4, -6], 'and it sits where the part sits');
});

test('a spot aims out of the face it names, turned the way the part is turned', () => {
    const mesh = batchedPart();
    mesh.rotation.set(0, Math.PI / 2, 0); // a quarter turn about Y
    mesh.updateWorldMatrix(true, false);

    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    mesh.matrixWorld.decompose(position, quat, new THREE.Vector3());

    const aim = (face) => new THREE.Vector3(...FACE_DIRECTION[face])
        .applyQuaternion(quat)
        .toArray()
        .map((n) => Math.round(n * 1e6) / 1e6);

    assert.deepEqual(aim('Bottom'), [0, -1, 0], 'down stays down whatever the part does about Y');
    assert.deepEqual(aim('Right'), [0, 0, -1], 'and +X has swung round to -Z');
});

test('the lumens a light quotes are what three.js calls power', () => {
    const light = new THREE.PointLight(0xffffff, 1);
    light.power = DEFAULT_POINT_LIGHT.intensity;

    assert.ok(Math.abs(light.intensity - DEFAULT_POINT_LIGHT.intensity / (4 * Math.PI)) < 1e-6);
    // Bright enough a few units away to read as a lamp, against a sun that sits at 1.6.
    assert.ok(light.intensity / 4 ** 2 > 1, 'a lamp lights what is next to it');
    assert.ok(light.intensity / 20 ** 2 < 1, 'and gives up across the room');
});

test('the rig defaults are the ones a map gets when it carries none', () => {
    assert.deepEqual(cleanLighting(null), DEFAULT_LIGHTING);
    assert.equal(cleanLighting({ brightness: 4001 }), null, 'past the ceiling is refused');
    assert.equal(cleanLighting({ nope: 1 }), null, 'a property the rig does not have is refused');
    assert.equal(DEFAULT_SPOT_LIGHT.face, 'Bottom');
});

test('a light slider spends its track where the usable values are', async () => {
    const { LOG_STEPS, logToValue, valueToLog } = await import('../resources/js/studio/scale.js');
    const MAX = 10_000_000;

    // The ends are exact, and zero stays reachable.
    assert.equal(logToValue(0, MAX), 0);
    assert.equal(valueToLog(0, MAX), 0);
    assert.equal(Math.round(logToValue(LOG_STEPS, MAX)), MAX);

    // The default lamp sits in the middle of the track rather than in the first pixel.
    const at = valueToLog(DEFAULT_POINT_LIGHT.intensity, MAX) / LOG_STEPS;
    assert.ok(at > 0.25 && at < 0.6, `the default lands at ${(at * 100).toFixed(0)}% of the track`);
    assert.ok(
        valueToLog(DEFAULT_POINT_LIGHT.intensity, MAX) / LOG_STEPS > 100 / MAX * 1000,
        'far off the floor a straight track would have left it on',
    );

    // Dragging and reading back lands on the same value, and the numbers stay round.
    for (const pos of [50, 200, 450, 700, 950]) {
        const value = logToValue(pos, MAX);
        assert.equal(logToValue(valueToLog(value, MAX), MAX), value, `round trip at ${pos}`);
        assert.equal(String(value).replace(/[0.]/g, '').length <= 3, true, `${value} is a round number`);
    }
});
