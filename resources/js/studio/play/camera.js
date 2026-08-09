import * as THREE from 'three';
import { BODY_HEIGHT, FEET_OFFSET } from './movement';

export const CAM_DISTANCE = 24;
export const LOOK_SPEED = 0.0025;
export const KEYBOARD_TURN_SPEED = 2.25;
export const PITCH_MIN = -1.2;
export const PITCH_MAX = 1.0;
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 80;
export const ZOOM_STEP = 3;

export const FIRST_PERSON = 3;

const EYE = BODY_HEIGHT - FEET_OFFSET - 0.6;

const WALL_PAD = 0.6;
const EASE_OUT = 9;

export function createCamera(camera) {
    let yaw = 0;
    let pitch = 0.22;
    let distance = CAM_DISTANCE;
    let shown = CAM_DISTANCE;

    const focus = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const dir = new THREE.Vector3();

    return {
        get yaw() { return yaw; },
        get pitch() { return pitch; },
        get distance() { return shown; },
        get firstPerson() { return shown < FIRST_PERSON; },

        look(dx, dy) {
            yaw -= dx * LOOK_SPEED;
            pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + dy * LOOK_SPEED));
        },
        turn(direction, dt) {
            yaw += direction * KEYBOARD_TURN_SPEED * dt;
        },
        zoom(delta) {
            distance = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, distance + delta * ZOOM_STEP));
        },
        reset(atYaw) {
            yaw = atYaw;
            pitch = 0.22;
            distance = CAM_DISTANCE;
            shown = CAM_DISTANCE;
        },

        update(dt, state, world) {
            focus.set(state.x, state.y + EYE, state.z);

            const cp = Math.cos(pitch);
            dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);

            let want = distance;
            if (world?.rayHit && want > 0) {
                const hit = world.rayHit(focus, dir, want + WALL_PAD);
                if (hit !== null) want = Math.max(0, hit - WALL_PAD);
            }

            shown = want < shown ? want : shown + (want - shown) * (1 - Math.exp(-dt * EASE_OUT));

            if (shown < FIRST_PERSON) {
                camera.position.copy(focus);
                camera.lookAt(
                    focus.x - dir.x,
                    focus.y - dir.y,
                    focus.z - dir.z,
                );
                return;
            }

            eye.copy(focus).addScaledVector(dir, shown);
            camera.position.copy(eye);
            camera.lookAt(focus);
        },
    };
}
