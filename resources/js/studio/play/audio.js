import * as THREE from 'three';
import { FALL_SPEED } from './character';

const BASE = '/play/sfx';

// The clips the client ships, and what it uses them for. A looping fall next to a
// one-shot start is the tell that the fall state is entered on a threshold and held
// rather than retriggered every frame.
const CLIPS = {
    jump: 'Jump.ogg',
    land: 'Land.ogg',
    walk: 'Walk.ogg',
    fallStart: 'FallStart.ogg',
    fallLoop: 'FallLoop.ogg',
};

// One stride of the walk clip. Footsteps are driven off distance travelled rather
// than a timer, so they keep step whatever the frame rate does.
const STRIDE = 4.6;
const VOLUME = { jump: 0.5, land: 0.6, walk: 0.35, fallStart: 0.5, fallLoop: 0.4 };
const REF_DISTANCE = 12;
const MAX_DISTANCE = 140;

let buffers = null;

function loadBuffers() {
    if (buffers) return buffers;
    const loader = new THREE.AudioLoader();
    const one = (file) => new Promise((resolve) => {
        loader.load(`${BASE}/${file}`, resolve, undefined, () => resolve(null));
    });
    buffers = Promise.all(Object.values(CLIPS).map(one))
        .then((list) => Object.fromEntries(Object.keys(CLIPS).map((k, i) => [k, list[i]])));
    // A failed decode must not wedge every later session on a rejected promise.
    buffers.catch(() => { buffers = null; });

    return buffers;
}

/**
 * The listener rides the camera, so everything is positional and a peer's footsteps
 * fall off with distance. Browsers will not start an AudioContext without a gesture,
 * which is what `resume` is for: the session calls it on the first key or pointer.
 */
export function createAudio(camera, scene) {
    const listener = new THREE.AudioListener();
    camera.add(listener);

    let ready = null;
    let disposed = false;
    const live = new Set();

    loadBuffers().then((b) => {
        if (!disposed) ready = b;
    }).catch(() => { /* the play test is still playable without sound */ });

    const attach = (name, at, loop) => {
        const buffer = ready?.[name];
        if (!buffer || disposed) return null;
        const sound = new THREE.PositionalAudio(listener);
        sound.setBuffer(buffer);
        sound.setRefDistance(REF_DISTANCE);
        sound.setMaxDistance(MAX_DISTANCE);
        sound.setVolume(VOLUME[name] ?? 1);
        sound.setLoop(loop);
        at.add(sound);
        live.add(sound);
        sound.play();

        return sound;
    };

    const release = (sound) => {
        if (!sound) return;
        try { sound.stop(); } catch { /* it never started */ }
        sound.removeFromParent();
        live.delete(sound);
    };

    // A one-shot gets its own node hung off a throwaway holder at the right place, so
    // overlapping plays never cut each other off.
    const anchor = new THREE.Object3D();
    scene.add(anchor);

    return {
        listener,
        resume() {
            const ctx = listener.context;
            if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
        },
        oneShot(name, x, y, z) {
            const holder = new THREE.Object3D();
            holder.position.set(x, y, z);
            anchor.add(holder);
            const sound = attach(name, holder, false);
            if (!sound) {
                holder.removeFromParent();
                return;
            }
            sound.onEnded = () => {
                release(sound);
                holder.removeFromParent();
            };
        },
        loop: (name, holder) => attach(name, holder, true),
        release,
        dispose() {
            disposed = true;
            for (const sound of [...live]) release(sound);
            anchor.removeFromParent();
            camera.remove(listener);
        },
    };
}

/**
 * The per-body half: turns the flags `movement.js` already sets into sound. One of
 * these per character, the local player and every peer alike, so a peer landing next
 * to you is audible in the right place.
 */
export function createBodyAudio(audio, scene) {
    const holder = new THREE.Object3D();
    scene.add(holder);

    let walkDistance = STRIDE;
    let wasFalling = false;
    let fallLoop = null;

    return {
        step(dt, state) {
            holder.position.set(state.x, state.y, state.z);
            const { x, y, z } = holder.position;

            if (state.jumped) audio.oneShot('jump', x, y, z);
            if (state.landed) audio.oneShot('land', x, y, z);

            // Footsteps come off ground distance, so they stop the frame the player
            // does and never fire in mid-air.
            if (state.grounded && state.moving) {
                walkDistance += state.speed * dt;
                if (walkDistance >= STRIDE) {
                    walkDistance %= STRIDE;
                    audio.oneShot('walk', x, y, z);
                }
            } else {
                walkDistance = STRIDE;
            }

            const falling = !state.grounded && state.vy < -FALL_SPEED;
            if (falling && !wasFalling) {
                audio.oneShot('fallStart', x, y, z);
                fallLoop = audio.loop('fallLoop', holder);
            } else if (!falling && wasFalling) {
                audio.release(fallLoop);
                fallLoop = null;
            }
            wasFalling = falling;
        },
        dispose() {
            audio.release(fallLoop);
            fallLoop = null;
            holder.removeFromParent();
        },
    };
}
