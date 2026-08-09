import { buildWorld, combineWorlds, spawnPoint } from './collision';
import { createCharacter, placeCharacter } from './character';
import { createCamera } from './camera';
import { createAudio, createBodyAudio } from './audio';
import { createPeers } from './peers';
import { createRigid, isLoose } from './rigid';
import * as move from './movement';

const FORWARD_KEYS = ['KeyW', 'ArrowUp'];
const BACK_KEYS = ['KeyS', 'ArrowDown'];
const RIGHT_KEYS = ['KeyD'];
const LEFT_KEYS = ['KeyA'];

const DEATH_HOLD = 1.1;

export function createSession({ scene, camera, canvas, parts, onExit, onDeath, onMoveParts }) {
    let fixed = buildWorld(parts, true);
    let world = fixed;
    let partsNow = parts;
    let rigid = null;
    const movedParts = [];
    const audio = createAudio(camera, scene);
    const peers = createPeers(scene, audio);
    const body = createBodyAudio(audio, scene);

    const view = createCamera(camera);
    const [sx, sy, sz] = spawnPoint(parts, world);
    const state = move.spawn(sx, sy, sz);
    state.dead = false;

    const keys = new Set();
    const touch = { forward: 0, strafe: 0, jump: false };
    let character = null;
    let disposed = false;
    let elapsed = 0;
    let deadFor = 0;
    let shift_lock = false;

    const savedCamera = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        fov: camera.fov,
    };

    const wake = () => audio.resume();

    const onKeyDown = (e) => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        if (e.code === 'Escape') {
            if (document.pointerLockElement === canvas) return;
            onExit?.();
            return;
        }
        if (e.code === 'Space') e.preventDefault();
        if (e.code.includes('Shift')) {
            shift_lock = !shift_lock;
        }
        if (e.code == 'Comma') {
            view.turn(0, -1, 0);
        } else if (e.code == 'Period') {
            view.turn(0, 1, 0);
        }
        wake();
        keys.add(e.code);
    };
    const onKeyUp = (e) => keys.delete(e.code);
    const onBlur = () => keys.clear();

    let dragging = null;
    let lastX = 0;
    let lastY = 0;
    const locked = () => document.pointerLockElement === canvas;

    const onPointerDown = (e) => {
        wake();
        if (locked()) return;
        if (e.pointerType === 'mouse' && e.button === 0) {
            try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* unsupported */ }
            return;
        }
        if (dragging !== null) return;
        if (e.pointerType === 'mouse' && e.button !== 2) return;
        e.preventDefault();
        dragging = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
        canvas.style.cursor = 'grabbing';
    };
    const onPointerMove = (e) => {
        if (locked()) {
            view.look(e.movementX ?? 0, e.movementY ?? 0);
            return;
        }
        if (dragging === null || e.pointerId !== dragging) return;
        if (e.pointerType === 'mouse' && (e.buttons & 2) === 0) {
            stopDragging(e);
            return;
        }
        view.look(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
    };
    function stopDragging(e) {
        if (dragging === null || e.pointerId !== dragging) return;
        dragging = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        canvas.style.cursor = '';
    }
    const onContextMenu = (e) => e.preventDefault();
    const onWheel = (e) => {
        e.preventDefault();
        view.zoom(Math.sign(e.deltaY));
    };
    const onLockChange = () => {
        canvas.style.cursor = locked() ? 'none' : '';
        if (!locked()) keys.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLockChange);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    createCharacter().then((c) => {
        if (disposed) {
            c.dispose();
            return;
        }
        character = c;
        scene.add(c.object);
    });

    if (parts.some(isLoose)) {
        createRigid(parts).then((r) => {
            if (disposed) {
                r.dispose();
                return;
            }
            rigid = r;
        }).catch(() => { /* the map is still playable without loose parts */ });
    }

    const axis = (plus, minus) => {
        let v = 0;
        for (const k of plus) if (keys.has(k)) v += 1;
        for (const k of minus) if (keys.has(k)) v -= 1;
        return Math.max(-1, Math.min(1, v));
    };
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));

    const respawn = () => {
        const [rx, ry, rz] = spawnPoint(partsNow, world);
        Object.assign(state, move.spawn(rx, ry, rz, state.yaw));
        state.dead = false;
        deadFor = 0;
        view.reset(state.yaw);
    };

    return {
        state,
        touch,
        setPeers: (states, who) => peers.set(states, who),
        setParts(next) {
            partsNow = next;
            fixed = buildWorld(next, true);
            world = fixed;
            const had = rigid;
            rigid = null;
            had?.dispose();
            if (!next.some(isLoose)) return;
            createRigid(next).then((r) => {
                if (disposed) {
                    r.dispose();
                    return;
                }
                rigid = r;
            }).catch(() => { /* the map is still playable without loose parts */ });
        },
        update(dt) {
            elapsed += dt;

            if (rigid) {
                rigid.setPlayer(state);
                if (rigid.step(dt) && (rigid.awake || world === fixed)) {
                    world = combineWorlds(fixed, buildWorld(rigid.parts));
                    onMoveParts?.(rigid.moved(movedParts));
                }
            }

            if (state.dead) {
                deadFor += dt;
                if (deadFor >= DEATH_HOLD) respawn();
            } else {
                view.turn(axis(['ArrowLeft'], ['ArrowRight']), 0, dt);
                move.step(state, {
                    forward: clamp1(axis(FORWARD_KEYS, BACK_KEYS) + touch.forward),
                    strafe: clamp1(axis(RIGHT_KEYS, LEFT_KEYS) + touch.strafe),
                    jump: keys.has('Space') || touch.jump,
                    yaw: view.yaw,
                    shift_lock
                }, dt, world);

                if (state.fell) {
                    state.dead = true;
                    deadFor = 0;
                    onDeath?.();
                }
            }

            if (state.dead) body.silence();
            else body.step(dt, state);
            view.update(dt, state, shift_lock, world);

            if (character) {
                placeCharacter(character, state);
                character.update(dt, state, elapsed);
                character.object.visible = !view.firstPerson && !state.dead;
            }
            peers.step(dt);
        },
        dispose() {
            disposed = true;
            rigid?.dispose();
            rigid = null;
            peers.dispose();
            body.dispose();
            audio.dispose();
            if (locked()) document.exitPointerLock?.();
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('pointerlockchange', onLockChange);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', stopDragging);
            canvas.removeEventListener('pointercancel', stopDragging);
            canvas.removeEventListener('contextmenu', onContextMenu);
            canvas.removeEventListener('wheel', onWheel);
            canvas.style.cursor = '';
            if (character) {
                scene.remove(character.object);
                character.dispose();
            }
            camera.position.copy(savedCamera.position);
            camera.quaternion.copy(savedCamera.quaternion);
            camera.fov = savedCamera.fov;
            camera.updateProjectionMatrix();
        },
    };
}
