import * as THREE from 'three';
import { buildWorld, spawnPoint } from './collision';
import { createCharacter, placeCharacter } from './character';
import * as move from './movement';

const CAM_DISTANCE = 24;
const CAM_HEIGHT = 4;
const LOOK_SPEED = 0.0025;
const PITCH_MIN = -1.2;
const PITCH_MAX = 1.0;
const ZOOM_MIN = 6;
const ZOOM_MAX = 80;

const FORWARD_KEYS = ['KeyW', 'ArrowUp'];
const BACK_KEYS = ['KeyS', 'ArrowDown'];
const RIGHT_KEYS = ['KeyD'];
const LEFT_KEYS = ['KeyA'];

export function createSession({ scene, camera, canvas, parts, onExit }) {
    const world = buildWorld(parts);
    const [sx, sy, sz] = spawnPoint(parts, world);
    const state = move.spawn(sx, sy, sz);
    const start = { x: sx, y: sy, z: sz };

    const keys = new Set();
    const touch = { forward: 0, strafe: 0, jump: false };
    let yaw = 0;
    let pitch = 0.22;
    let distance = CAM_DISTANCE;
    let character = null;
    let disposed = false;
    let elapsed = 0;

    const savedCamera = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        fov: camera.fov,
    };

    const onKeyDown = (e) => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        if (e.code === 'Escape') {
            onExit?.();
            return;
        }
        if (e.code === 'Space') e.preventDefault();
        keys.add(e.code);
    };
    const onKeyUp = (e) => keys.delete(e.code);
    const onBlur = () => keys.clear();

    let looking = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e) => {
        if (looking !== null) return;
        if (e.pointerType === 'mouse' && e.button !== 2) return;
        e.preventDefault();
        looking = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
        canvas.style.cursor = 'grabbing';
    };
    const onPointerMove = (e) => {
        if (looking === null || e.pointerId !== looking) return;
        if (e.pointerType === 'mouse' && (e.buttons & 2) === 0) {
            stopLooking(e);
            return;
        }
        yaw -= (e.clientX - lastX) * LOOK_SPEED;
        pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + (e.clientY - lastY) * LOOK_SPEED));
        lastX = e.clientX;
        lastY = e.clientY;
    };
    function stopLooking(e) {
        if (looking === null || e.pointerId !== looking) return;
        looking = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        canvas.style.cursor = '';
    }
    const onContextMenu = (e) => e.preventDefault();
    const onWheel = (e) => {
        e.preventDefault();
        distance = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, distance + Math.sign(e.deltaY) * 3));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', stopLooking);
    canvas.addEventListener('pointercancel', stopLooking);
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

    const axis = (plus, minus) => {
        let v = 0;
        for (const k of plus) if (keys.has(k)) v += 1;
        for (const k of minus) if (keys.has(k)) v -= 1;
        return Math.max(-1, Math.min(1, v));
    };

    const eye = new THREE.Vector3();
    const focus = new THREE.Vector3();

    const clamp1 = (v) => Math.max(-1, Math.min(1, v));

    return {
        state,
        touch,
        update(dt) {
            elapsed += dt;
            move.step(state, {
                forward: clamp1(axis(FORWARD_KEYS, BACK_KEYS) + touch.forward),
                strafe: clamp1(axis(RIGHT_KEYS, LEFT_KEYS) + touch.strafe),
                jump: keys.has('Space') || touch.jump,
                yaw,
            }, dt, world);

            if (state.fell) {
                Object.assign(state, move.spawn(start.x, start.y, start.z, state.yaw));
            }

            focus.set(state.x, state.y + CAM_HEIGHT - move.FEET_OFFSET, state.z);
            const cp = Math.cos(pitch);
            eye.set(
                focus.x + Math.sin(yaw) * cp * distance,
                focus.y + Math.sin(pitch) * distance,
                focus.z + Math.cos(yaw) * cp * distance,
            );
            camera.position.copy(eye);
            camera.lookAt(focus);

            if (character) {
                placeCharacter(character, state);
                character.update(dt, state, elapsed);
            }
        },
        dispose() {
            disposed = true;
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', stopLooking);
            canvas.removeEventListener('pointercancel', stopLooking);
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
