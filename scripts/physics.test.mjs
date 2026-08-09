import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorld, combineWorlds } from '../resources/js/studio/play/collision.js';
import { createRigid, isLoose } from '../resources/js/studio/play/rigid.js';
import * as move from '../resources/js/studio/play/movement.js';

const floor = { _id: 'floor', T: 'Part', P: [0, -1, 0], S: [200, 2, 200], R: [0, 0, 0] };
const box = (id, x, y, z, s = 4, extra = {}) => ({
    _id: id, T: 'Part', P: [x, y, z], S: [s, s, s], R: [0, 0, 0], An: false, ...extra,
});

const settle = (rigid, seconds = 4) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) rigid.step(1 / 60);
};
const at = (rigid, id) => rigid.parts.find((p) => p._id === id);

test('a part is loose only when it is unanchored and collidable', () => {
    assert.equal(isLoose(box('a', 0, 0, 0)), true);
    assert.equal(isLoose(floor), false, 'no An key means anchored');
    assert.equal(isLoose({ ...box('a', 0, 0, 0), An: true }), false);
    assert.equal(isLoose({ ...box('a', 0, 0, 0), Cc: false }), false, 'nothing to collide');
});

test('the static world leaves loose parts out, and keeps anchored ones', () => {
    const parts = [floor, box('a', 0, 20, 0)];
    assert.equal(buildWorld(parts).count, 2);
    assert.equal(buildWorld(parts, true).count, 1);
});

test('an unanchored part falls and lands on the anchored floor', async () => {
    const rigid = await createRigid([floor, box('a', 0, 30, 0)]);
    assert.equal(rigid.count, 1);
    assert.equal(at(rigid, 'a').P[1], 30);
    settle(rigid);
    assert.ok(Math.abs(at(rigid, 'a').P[1] - 2) < 0.05, `landed at ${at(rigid, 'a').P[1]}`);
    rigid.dispose();
});

test('an anchored part does not fall', async () => {
    const rigid = await createRigid([floor, { ...box('a', 0, 30, 0), An: true }]);
    assert.equal(rigid.count, 0, 'anchored parts are not bodies');
    rigid.dispose();
});

test('loose parts stack on each other', async () => {
    const rigid = await createRigid([floor, box('a', 0, 10, 0), box('b', 0, 30, 0)]);
    settle(rigid, 6);
    const ys = [at(rigid, 'a').P[1], at(rigid, 'b').P[1]].sort((p, q) => p - q);
    assert.ok(Math.abs(ys[0] - 2) < 0.1, `lower box at ${ys[0]}`);
    assert.ok(Math.abs(ys[1] - 6) < 0.2, `upper box at ${ys[1]}`);
    rigid.dispose();
});

test('a box dropped on its corner topples flat', async () => {
    const tilted = { ...box('a', 0, 20, 0), R: [0, 0, 35] };
    const rigid = await createRigid([floor, tilted]);
    settle(rigid, 6);
    const r = at(rigid, 'a').R.map((d) => Math.abs(((d % 90) + 90) % 90));
    const settledFlat = r.every((d) => d < 3 || d > 87);
    assert.ok(settledFlat, `came to rest at ${at(rigid, 'a').R}`);
    rigid.dispose();
});

test('everything goes to sleep once it has settled', async () => {
    const rigid = await createRigid([floor, box('a', 0, 20, 0)]);
    settle(rigid, 8);
    assert.equal(rigid.awake, false);
    assert.equal(rigid.moved([]).length, 0, 'a sleeping part is not redrawn');
    rigid.dispose();
});

test('the player stands on a loose part where it came to rest', async () => {
    const rigid = await createRigid([floor, box('a', 0, 20, 0, 8)]);
    settle(rigid, 6);
    const top = at(rigid, 'a').P[1] + 4;
    assert.ok(Math.abs(top - 8) < 0.1, `box top at ${top}`);

    const world = combineWorlds(buildWorld([floor], true), buildWorld(rigid.parts));
    const s = move.spawn(0, top, 0);
    const idle = { forward: 0, strafe: 0, jump: false, yaw: 0 };
    for (let i = 0; i < 240; i++) move.step(s, idle, 1 / 240, world);
    assert.ok(Math.abs(move.feetY(s) - top) < 0.05, `player rests at ${move.feetY(s)}`);
    assert.equal(s.grounded, true);
    rigid.dispose();
});

test('without the loose part the player falls straight past', async () => {
    const rigid = await createRigid([floor, box('a', 0, 20, 0, 8)]);
    settle(rigid, 6);
    const top = at(rigid, 'a').P[1] + 4;
    const world = buildWorld([floor], true);
    const s = move.spawn(0, top, 0);
    const idle = { forward: 0, strafe: 0, jump: false, yaw: 0 };
    for (let i = 0; i < 240; i++) move.step(s, idle, 1 / 240, world);
    assert.ok(Math.abs(move.feetY(s)) < 0.05, `player fell to ${move.feetY(s)}`);
    rigid.dispose();
});

test('the player body shoves a loose part out of the way', async () => {
    const rigid = await createRigid([floor, box('a', 0, 2, 0)]);
    settle(rigid, 3);
    const before = at(rigid, 'a').P[0];

    for (let i = 0; i < 180; i++) {
        rigid.setPlayer({ x: -6 + i * 0.06, y: 2.08, z: 0 });
        rigid.step(1 / 60);
    }
    const after = at(rigid, 'a').P[0];
    assert.ok(after - before > 1, `box moved ${after - before} studs`);
    rigid.dispose();
});

test('the fixed step keeps the result the same whatever the frame rate', async () => {
    const drop = async (dt, frames) => {
        const rigid = await createRigid([floor, box('a', 0, 30, 0)]);
        for (let i = 0; i < frames; i++) rigid.step(dt);
        const y = at(rigid, 'a').P[1];
        rigid.dispose();
        return y;
    };
    const smooth = await drop(1 / 60, 60);
    const choppy = await drop(1 / 30, 30);
    assert.ok(Math.abs(smooth - choppy) < 0.01, `${smooth} vs ${choppy}`);
});
