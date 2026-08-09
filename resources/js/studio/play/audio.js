import * as THREE from 'three';
import { FALL_SPEED } from './character';
import { WALK_SPEED } from './movement';

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

// Walk.ogg is not one footstep: it is a cycle of four, evenly spaced, ending exactly
// where it began. It is held as a loop for as long as the feet are moving, the way
// the fall is, and the rate is what carries the pace — retriggering the whole cycle
// per stride stacks four overlapping copies of it and reads as a stampede.
const WALK_RATE = { min: 0.55, max: 1.5 };

// Below this the feet are shuffling, not walking, and the loop is not worth starting.
const WALK_FLOOR = 1;

// Ground is lost for a frame or two over every seam and kerb. Holding the loop across
// that keeps a walk over uneven ground from restarting the cycle at every bump, and is
// far too short to be heard under a jump.
const WALK_HOLD = 0.12;

// A jump of your own lands at exactly JUMP_VELOCITY, so anything past it is a drop
// deeper than you can put yourself in. The margin over it is about three studs below
// the lip you left, which keeps the scream off ledges you step down and hops you take.
const FALL_TRIGGER = 60;

// The impact that is worth a thud. A jump lands well past it; walking off a kerb or
// down a step does not, and used to fire Land.ogg on every stair.
const LAND_TRIGGER = FALL_SPEED;

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

    const attach = (name, at, loop, onEnded = null) => {
        const buffer = ready?.[name];
        if (!buffer || disposed) return null;
        const sound = new THREE.PositionalAudio(listener);
        sound.setBuffer(buffer);
        sound.setRefDistance(REF_DISTANCE);
        sound.setMaxDistance(MAX_DISTANCE);
        sound.setVolume(VOLUME[name] ?? 1);
        sound.setLoop(loop);
        if (onEnded) {
            sound.onEnded = () => {
                // three's own handler is what marks the node stopped; replacing it
                // outright leaves the sound believing it is still playing.
                sound.isPlaying = false;
                onEnded();
            };
        }
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
            const sound = attach(name, holder, false, () => {
                release(sound);
                holder.removeFromParent();
            });
            if (!sound) holder.removeFromParent();
        },
        // A one-shot that rides the body instead of the spot it started at, and that
        // the caller keeps hold of: a fall has to be cut the moment it ends, not left
        // screaming over someone who is already standing up.
        once: (name, holder, onEnded) => attach(name, holder, false, onEnded),
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

    let walk = null;
    let wasFalling = false;
    let fallStart = null;
    let fallLoop = null;
    // The impact is read off the way down: by the frame `landed` is up the controller
    // has already zeroed vy, so the speed that did the landing is gone.
    let drop = 0;
    let air = 0;

    const hush = () => {
        audio.release(walk);
        audio.release(fallStart);
        audio.release(fallLoop);
        walk = null;
        fallStart = null;
        fallLoop = null;
        wasFalling = false;
        drop = 0;
        air = 0;
    };

    return {
        step(dt, state) {
            holder.position.set(state.x, state.y, state.z);
            const { x, y, z } = holder.position;

            if (state.jumped) audio.oneShot('jump', x, y, z);
            if (state.landed && drop < -LAND_TRIGGER) audio.oneShot('land', x, y, z);
            drop = state.grounded ? 0 : Math.min(drop, state.vy);

            air = state.grounded ? 0 : air + dt;

            // Feet on the ground and going somewhere, or nothing. The loop stops the
            // frame the player does, and a jump outruns the hold, so it is never heard
            // in mid-air.
            if (air < WALK_HOLD && state.moving && state.speed > WALK_FLOOR) {
                walk = walk ?? audio.loop('walk', holder);
                walk?.setPlaybackRate(Math.min(
                    Math.max(state.speed / WALK_SPEED, WALK_RATE.min),
                    WALK_RATE.max,
                ));
            } else if (walk) {
                audio.release(walk);
                walk = null;
            }

            const falling = !state.grounded && state.vy < -FALL_TRIGGER;
            if (falling && !wasFalling) {
                // The loop is the tail of the start, not a second voice over it.
                fallStart = audio.once('fallStart', holder, () => {
                    fallStart = null;
                    if (wasFalling) fallLoop = audio.loop('fallLoop', holder);
                });
            } else if (!falling && wasFalling) {
                audio.release(fallStart);
                audio.release(fallLoop);
                fallStart = null;
                fallLoop = null;
            }
            wasFalling = falling;
        },
        // Death stops the body being stepped at all, which would otherwise leave
        // whatever was playing at that moment looping over the corpse.
        silence: hush,
        dispose() {
            hush();
            holder.removeFromParent();
        },
    };
}
