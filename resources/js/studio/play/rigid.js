import * as THREE from 'three';
import { isAnchored, canCollide } from '../materials';
import { GRAVITY, BODY_HEIGHT, FEET_OFFSET, HALF_WIDTH } from './movement';

const FRICTION = 0.3;
const RESTITUTION = 0;
const DENSITY = 1;

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

    const playerBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1e6, 0),
    );
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(HALF_WIDTH, BODY_HEIGHT / 2, HALF_WIDTH)
            .setFriction(FRICTION)
            .setRestitution(RESTITUTION),
        playerBody,
    );

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
