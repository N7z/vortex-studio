import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorld } from '../resources/js/studio/play/collision.js';
import { createBodyAudio } from '../resources/js/studio/play/audio.js';
import * as move from '../resources/js/studio/play/movement.js';

const scene = { add() {}, remove() {} };

const spy = (heard) => {
    const node = (name) => ({ name, setPlaybackRate() {} });

    return {
        oneShot: (name) => heard.push(name),
        once: (name) => { heard.push(name); return node(name); },
        loop: (name) => { heard.push(name); return node(name); },
        release: () => {},
    };
};

const floor = { _id: 'f', T: 'Part', P: [0, -1, 0], S: [400, 2, 400], R: [0, 0, 0] };

const play = ({ parts = [floor], from = [0, 0, 0], seconds, input = () => ({}) }) => {
    const world = buildWorld(parts, true);
    const heard = [];
    const body = createBodyAudio(spy(heard), scene);
    const state = move.spawn(from[0], from[1], from[2]);
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
        move.step(state, { forward: 0, strafe: 0, jump: false, yaw: 0, ...input(i / 60, state) }, dt, world);
        body.step(dt, state);
    }
    body.dispose();

    return heard.reduce((n, name) => ({ ...n, [name]: (n[name] ?? 0) + 1 }), {});
};

const walking = () => ({ forward: 1 });

test('a walk is one held loop, however long it goes on', () => {
    const heard = play({ seconds: 4, input: walking });
    assert.equal(heard.walk, 1, 'the four-step cycle is looped, not retriggered per stride');
    assert.equal(heard.fallStart, undefined);
});

test('standing still is silent', () => {
    assert.deepEqual(play({ seconds: 2 }), {});
});

test('a jump is a jump and a landing, and never a fall', () => {
    const heard = play({ seconds: 2, input: (t) => ({ jump: t > 0.2 && t < 0.25 }) });
    assert.equal(heard.jump, 1);
    assert.equal(heard.land, 1);
    assert.equal(heard.fallStart, undefined, 'your own jump must not scream');
});

test('a step down does not restart the walk, thud or scream', () => {
    const ledge = { _id: 'l', T: 'Part', P: [0, 0.5, -10], S: [40, 2, 40], R: [0, 0, 0] };
    const heard = play({ parts: [floor, ledge], from: [0, 2, -10], seconds: 3, input: walking });
    assert.equal(heard.walk, 1, 'a seam underfoot must not restart the cycle');
    assert.equal(heard.land, undefined);
    assert.equal(heard.fallStart, undefined);
});

test('a drop no deeper than a jump lands without a fall', () => {
    const heard = play({ from: [0, 8, 0], seconds: 3 });
    assert.equal(heard.land, 1);
    assert.equal(heard.fallStart, undefined);
});

test('a real fall screams once and lands', () => {
    const heard = play({ from: [0, 100, 0], seconds: 4 });
    assert.equal(heard.fallStart, 1, 'entered on a threshold and held, not retriggered');
    assert.equal(heard.land, 1);
});
