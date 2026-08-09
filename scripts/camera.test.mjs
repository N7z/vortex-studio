import test from 'node:test';
import assert from 'node:assert/strict';

import { createCamera, KEYBOARD_TURN_SPEED } from '../resources/js/studio/play/camera.js';

const turnForOneSecond = (fps) => {
    const view = createCamera({});
    for (let frame = 0; frame < fps; frame++) view.turn(1, 1 / fps);
    return view.yaw;
};

test('arrow-key camera turning is independent of frame rate', () => {
    const at60 = turnForOneSecond(60);
    const at144 = turnForOneSecond(144);

    assert.ok(Math.abs(at60 - KEYBOARD_TURN_SPEED) < 1e-12);
    assert.ok(Math.abs(at144 - KEYBOARD_TURN_SPEED) < 1e-12);
    assert.ok(Math.abs(at60 - at144) < 1e-12);
});
