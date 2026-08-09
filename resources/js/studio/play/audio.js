import * as THREE from 'three';
import { FALL_SPEED } from './character';
import { WALK_SPEED } from './movement';

const BASE = '/play/sfx';

const CLIPS = {
    jump: 'Jump.ogg',
    land: 'Land.ogg',
    walk: 'Walk.ogg',
    fallStart: 'FallStart.ogg',
    fallLoop: 'FallLoop.ogg',
};

const WALK_RATE = { min: 0.55, max: 1.5 };

const WALK_FLOOR = 1;

const WALK_HOLD = 0.12;

const FALL_TRIGGER = 60;

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
    buffers.catch(() => { buffers = null; });

    return buffers;
}

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

export function createBodyAudio(audio, scene) {
    const holder = new THREE.Object3D();
    scene.add(holder);

    let walk = null;
    let wasFalling = false;
    let fallStart = null;
    let fallLoop = null;
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
        silence: hush,
        dispose() {
            hush();
            holder.removeFromParent();
        },
    };
}
