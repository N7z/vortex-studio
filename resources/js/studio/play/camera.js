import * as THREE from 'three';
import { BODY_HEIGHT, FEET_OFFSET } from './movement';

export const CAM_DISTANCE = 24;
export const LOOK_SPEED = 0.0025;
export const PITCH_MIN = -1.2;
export const PITCH_MAX = 1.0;
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 80;
export const ZOOM_STEP = 3;

// Below this the camera is inside the head, so the body is hidden and the eye sits
// at eye height rather than orbiting a focus point.
export const FIRST_PERSON = 3;

// Where the camera looks: eye height on the body, measured from the transform origin.
const EYE = BODY_HEIGHT - FEET_OFFSET - 0.6;

// Kept off the surface it collided with, so the near plane never clips into it.
const WALL_PAD = 0.6;
// The camera catches up rather than snapping, but only on the way out — pulling in
// has to be instant or the wall is already through the near plane.
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

            // The wall the camera would sit inside is found along the same ray it
            // orbits on, so the eye slides along it rather than jumping around it.
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
