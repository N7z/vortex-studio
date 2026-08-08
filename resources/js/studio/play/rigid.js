import * as THREE from 'three';
import { isAnchored, canCollide } from '../materials';
import { GRAVITY, BODY_HEIGHT, FEET_OFFSET, HALF_WIDTH } from './movement';

// The desktop Studio runs its play test on avian3d 0.2.1, which is XPBD on top of
// parry. Rapier is parry's sibling from the same authors, so the same map behaves
// close to the same way. What the Studio's own systems pin down
// (../../../../VortexStuff/docs/STUDIO_PHYSICS.md):
//
//   fn_7c69132399  builds a body per Part, keyed on an `Anchored` marker component
//   fn_f3785c9dab  mirrors the player Transform into avian Position/Rotation, so the
//                  hand-rolled controller stays in charge and the body only pushes
//   fn_c0a7d26c1d  shoves loose parts away from the player, weighted by mass
//   fn_5d89141155  tears it all down when the play test stops
//
// Gravity is (0, -196.2, 0) there, the same value the character controller uses.
//
// Friction, restitution and density are avian 0.2.1's defaults. The Studio would only
// carry others if it overrode them, which is the unusual case and was not confirmed;
// these three are the numbers to revisit if a map settles differently than it does in
// the desktop app.
const FRICTION = 0.3;
const RESTITUTION = 0;
const DENSITY = 1;

// Steps are run at a fixed rate and caught up in whole steps, so the simulation does
// not change character with the frame rate. Four is enough to absorb a hitch without
// letting a stall turn into a long catch-up.
const FIXED_STEP = 1 / 60;
const MAX_STEPS = 4;

const DEG = Math.PI / 180;

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();

export const isLoose = (part) => !isAnchored(part) && canCollide(part);

function quaternionOf(part) {
    const r = part.R;
    euler.set((r?.[0] ?? 0) * DEG, (r?.[1] ?? 0) * DEG, (r?.[2] ?? 0) * DEG, 'XYZ');
    quat.setFromEuler(euler);

    return { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
}

/**
 * Loads the engine once per page. Rapier ships as WebAssembly, so this is async and
 * the play test runs statically until it lands rather than waiting on it.
 */
let enginePromise = null;
function engine() {
    if (!enginePromise) {
        enginePromise = import('@dimforge/rapier3d-compat')
            .then((RAPIER) => RAPIER.init().then(() => RAPIER));
        enginePromise.catch(() => { enginePromise = null; });
    }

    return enginePromise;
}

export async function createRigid(parts) {
    const RAPIER = await engine();
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = FIXED_STEP;

    const loose = new Map();
    let carry = 0;

    const describe = (part, dynamic) => {
        const [px, py, pz] = part.P;
        const q = quaternionOf(part);
        const desc = (dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
            .setTranslation(px, py, pz)
            .setRotation(q);
        const bodyHandle = world.createRigidBody(desc);
        const [sx, sy, sz] = part.S;
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
                .setFriction(FRICTION)
                .setRestitution(RESTITUTION)
                .setDensity(DENSITY),
            bodyHandle,
        );

        return bodyHandle;
    };

    const build = (list) => {
        for (const part of list) {
            if (!Array.isArray(part.P) || !Array.isArray(part.S)) continue;
            if (!(part.S[0] > 0 && part.S[1] > 0 && part.S[2] > 0)) continue;
            if (!canCollide(part)) continue;
            const dynamic = !isAnchored(part);
            const body = describe(part, dynamic);
            if (dynamic) loose.set(part._id, { body, part });
        }
    };
    build(parts);

    // The player is a kinematic body: the hand-rolled controller stays authoritative
    // and this only exists so loose parts are shoved out of the way, which is exactly
    // the split the Studio uses.
    const playerBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1e6, 0),
    );
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(HALF_WIDTH, BODY_HEIGHT / 2, HALF_WIDTH)
            .setFriction(FRICTION)
            .setRestitution(RESTITUTION),
        playerBody,
    );

    // The overlay the character controller queries. Only rebuilt while something is
    // awake, so a settled map costs nothing.
    const overlay = [];
    let awake = true;

    const readBack = () => {
        overlay.length = 0;
        awake = false;
        for (const { body, part } of loose.values()) {
            if (!body.isSleeping()) awake = true;
            const t = body.translation();
            const r = body.rotation();
            quat.set(r.x, r.y, r.z, r.w);
            euler.setFromQuaternion(quat, 'XYZ');
            overlay.push({
                ...part,
                P: [t.x, t.y, t.z],
                R: [euler.x / DEG, euler.y / DEG, euler.z / DEG],
            });
        }
    };
    readBack();

    return {
        get count() { return loose.size; },
        get awake() { return awake; },
        // Parts as the collision world wants them, at their current transform.
        get parts() { return overlay; },

        setPlayer(state) {
            playerBody.setNextKinematicTranslation({
                x: state.x,
                y: state.y - FEET_OFFSET + BODY_HEIGHT / 2,
                z: state.z,
            });
        },

        step(dt) {
            if (!loose.size) return false;
            carry = Math.min(carry + dt, FIXED_STEP * MAX_STEPS);
            let stepped = false;
            while (carry >= FIXED_STEP) {
                carry -= FIXED_STEP;
                world.step();
                stepped = true;
            }
            if (stepped) readBack();

            return stepped;
        },

        // What the viewport needs to redraw: only the parts that actually moved.
        moved(into) {
            into.length = 0;
            for (const { body, part } of loose.values()) {
                if (body.isSleeping()) continue;
                const t = body.translation();
                const r = body.rotation();
                into.push({ id: part._id, p: t, q: r });
            }

            return into;
        },

        dispose() {
            loose.clear();
            overlay.length = 0;
            world.free();
        },
    };
}
