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
    let freecam = false;

    const focus = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const dir = new THREE.Vector3();

    const api = {
        get yaw() { return yaw; },
        get pitch() { return pitch; },
        get distance() { return shown; },
        get firstPerson() { return shown < FIRST_PERSON; },
        get freecam() { return freecam },

        look(dx, dy) {
            yaw -= dx * LOOK_SPEED;
            pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + dy * LOOK_SPEED));
        },
        turn(direction, alignment_direction, dt) {
            yaw += direction * KEYBOARD_TURN_SPEED * dt;
            yaw += alignment_direction * -Math.PI/4;
            if (alignment_direction) yaw = Math.round(yaw / (Math.PI / 4)) * (Math.PI / 4);
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
        set_freecam() {
            freecam = !freecam;
        },

	    freecam_update(input, dt) {
		    const speed = input.shift ? 120 : 40;

		    const cp = -Math.cos(-pitch);
		    const sp = -Math.sin(pitch);
		    const sin = Math.sin(yaw);
		    const cos = Math.cos(yaw);

		    const forwarddir = new THREE.Vector3(sin*cp, sp, cos*cp);
		    const rightdir = new THREE.Vector3(cos, 0, -sin);

            camera.position.addScaledVector(forwarddir, input.forward * speed * dt);
		    camera.position.addScaledVector(rightdir, input.strafe * speed * dt);
		    camera.position.y -= input.up * speed * dt;

		    camera.lookAt(
			    camera.position.x + forwarddir.x,
			    camera.position.y + forwarddir.y,
			    camera.position.z + forwarddir.z
		    );
	    },

        update(dt, state, input, world) {
            if (freecam) return this.freecam_update(input, dt);
            focus.set(state.x, state.y + EYE, state.z);

            if (input.shift_lock) {
                const sin = Math.sin(yaw);
                const cos = Math.cos(yaw);
                focus.x += cos * Math.min(1, distance/3);
                focus.z += -sin * Math.min(1, distance/3);
            }

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
    return api;
}
