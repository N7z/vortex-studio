// Every constant here is one the client itself carries. See
// ../../../../VortexStuff/docs/MOVEMENT.md for the v0.2.16 pass and
// MOVEMENT_0_2_2x.md for the re-derivation this file is matched to, which is where
// the residual model, the collider offsets and the ceiling resolve come from.
export const GRAVITY = -196.2;
export const WALK_SPEED = 16;
export const JUMP_VELOCITY = 50;
export const MAX_DT = 0.033;
export const GROUND_SNAP_RATE = 16;
export const COYOTE_TIME = 0.12;
export const JUMP_BUFFER = 0.15;
export const VOID_Y = -500;
export const INPUT_EPSILON = 0.01;

// External velocity — a slope, an impulse, a moving surface. The client decays it
// two different ways and picks between them on speed_override; the multiply is the
// one that runs in ordinary play.
export const RESIDUAL_DECAY = 2.5;
export const RESIDUAL_STOP = 0.3;
export const RESIDUAL_LINEAR = 142;

export const TURN_EASE = 0.06;
export const SLOPE_LIMIT = Math.cos((45 * Math.PI) / 180);

// The body box is not centred on the transform origin: the feet are 2.08 below it
// and the head 2.92 above, for the 5 studs the client uses as the total.
export const BODY_HEIGHT = 5;
export const FEET_OFFSET = 2.08;
export const HEAD_OFFSET = BODY_HEIGHT - FEET_OFFSET;
export const HALF_WIDTH = 1;
export const STEP_HEIGHT = 2;
export const SKIN = 0.1;

export function spawn(x, y, z, yaw = 0) {
    return {
        x,
        y: y + FEET_OFFSET,
        z,
        vx: 0,
        vz: 0,
        vy: 0,
        heading: yaw,
        yaw,
        residualX: 0,
        residualZ: 0,
        speedOverride: 0,
        sliding: false,
        grounded: false,
        coyote: 0,
        jumpBuffer: 0,
        speed: 0,
        moving: false,
        jumped: false,
        landed: false,
        bumped: false,
        fell: false,
    };
}

export function feetY(s) {
    return s.y - FEET_OFFSET;
}

export function headY(s) {
    return s.y + HEAD_OFFSET;
}

export function step(s, input, rawDt, world) {
    const dt = Math.min(rawDt, MAX_DT);
    s.jumped = false;
    s.landed = false;
    s.bumped = false;
    s.fell = false;

    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    const dx = input.strafe * cos - input.forward * sin;
    const dz = -input.strafe * sin - input.forward * cos;

    // The client normalizes the direction and scales it by the walk speed, then adds
    // the residual and clamps the sum once. Splitting that into two moves is what
    // lets a slide plus a walk exceed the cap.
    let wishX = 0;
    let wishZ = 0;
    const inputSq = dx * dx + dz * dz;
    if (inputSq >= INPUT_EPSILON) {
        const target = Math.atan2(dx, dz);
        s.heading = s.moving
            ? approachAngle(s.heading, target, 1 - Math.exp(-dt / TURN_EASE))
            : target;
        wishX = Math.sin(s.heading) * WALK_SPEED;
        wishZ = Math.cos(s.heading) * WALK_SPEED;
        s.moving = true;
        s.yaw = Math.atan2(-wishX, -wishZ);
    } else {
        s.moving = false;
    }

    let velX = s.residualX + wishX;
    let velZ = s.residualZ + wishZ;
    const cap = s.speedOverride > 0
        ? Math.max(Math.hypot(s.residualX, s.residualZ), WALK_SPEED)
        : WALK_SPEED;
    const velSq = velX * velX + velZ * velZ;
    if (velSq > cap * cap) {
        const k = cap / Math.sqrt(velSq);
        velX *= k;
        velZ *= k;
    }
    s.vx = velX;
    s.vz = velZ;
    s.speed = Math.hypot(velX, velZ);
    if (velX !== 0 || velZ !== 0) moveHorizontal(s, velX * dt, velZ * dt, world);

    if (input.jump) s.jumpBuffer = JUMP_BUFFER;
    if (s.jumpBuffer > 0 && (s.grounded || s.coyote > 0)) {
        s.vy = JUMP_VELOCITY;
        s.grounded = false;
        s.coyote = 0;
        s.jumpBuffer = 0;
        s.jumped = true;
    }
    s.jumpBuffer = Math.max(s.jumpBuffer - dt, 0);

    const onGround = world ? world.groundAt(s.x, s.z, s.y, feetY(s), ground) : false;
    const target = onGround ? ground.y + FEET_OFFSET : null;
    const steep = onGround && ground.ny < SLOPE_LIMIT;
    s.sliding = steep;

    // A steep face pushes into the residual, which is what the channel is for. The
    // client has no slope handling of its own — its parts are axis-aligned boxes —
    // so this is the studio's, routed through the client's speed cap and decay.
    if (steep) {
        const g = -GRAVITY * ground.ny;
        s.residualX += g * ground.nx * dt;
        s.residualZ += g * ground.nz * dt;
    }

    const wasGrounded = s.grounded;
    if (target !== null && target > s.y) {
        s.y += Math.min(GROUND_SNAP_RATE * dt, target - s.y);
        s.vy = 0;
        s.grounded = true;
    } else if (s.grounded) {
        s.coyote = COYOTE_TIME;
    }

    s.coyote = Math.max(s.coyote - dt, 0);
    s.vy += GRAVITY * dt;
    s.y += s.vy * dt;
    s.grounded = false;

    if (s.y < VOID_Y) {
        s.fell = true;
        decayResidual(s, dt, steep);
        return s;
    }

    resolveBody(s, target, steep, world);
    if (s.grounded && !wasGrounded) s.landed = true;

    decayResidual(s, dt, steep);
    return s;
}

const ground = { y: 0, nx: 0, ny: 1, nz: 0 };

// The client resolves the body box out of every part it overlaps, pushing along
// whichever of the two vertical penetrations is smaller. Ours works off the same
// surface query the ground snap uses, plus a ceiling query, which gives the same
// answer for the boxes a map is made of.
function resolveBody(s, target, steep, world) {
    if (target !== null && s.y <= target) {
        s.y = target;
        if (s.vy < 0) {
            s.vy = 0;
            s.grounded = true;
            s.coyote = COYOTE_TIME;
            if (!steep) {
                s.residualX = 0;
                s.residualZ = 0;
            }
        }
        return;
    }

    if (!world?.ceilingAt) return;
    const hit = world.ceilingAt(s.x, s.z, feetY(s), headY(s), HALF_WIDTH);
    if (hit === null) return;

    // Push down only when the head is the shallower way out; otherwise the ground
    // pass above owns it and this would fight it.
    const up = target !== null ? target - s.y : Infinity;
    const down = headY(s) - hit;
    if (down >= up) return;

    s.y = hit - HEAD_OFFSET;
    if (s.vy > 0) {
        s.vy = 0;
        s.bumped = true;
    }
}

function decayResidual(s, dt, steep) {
    if (s.residualX === 0 && s.residualZ === 0) return;
    if (s.speedOverride > 0) {
        const stepBy = dt * RESIDUAL_LINEAR;
        s.residualX -= Math.sign(s.residualX) * Math.min(stepBy, Math.abs(s.residualX));
        s.residualZ -= Math.sign(s.residualZ) * Math.min(stepBy, Math.abs(s.residualZ));
        return;
    }
    const k = Math.max(1 - RESIDUAL_DECAY * dt, 0);
    s.residualX *= k;
    s.residualZ *= k;
    // The deadzone is what stops a slide dribbling forever. On a steep face the
    // accelerator above refills it every frame, so it only bites once you are off.
    if (!steep) {
        if (Math.abs(s.residualX) < RESIDUAL_STOP) s.residualX = 0;
        if (Math.abs(s.residualZ) < RESIDUAL_STOP) s.residualZ = 0;
    }
}

function approachAngle(from, to, k) {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + d * k;
}

// The wall test samples the leading edge of the body rather than a box centred on
// it. A centred box has its uphill corner buried in any slope steeper than
// atan(STEP_HEIGHT / HALF_WIDTH), which reads as a wall and pins the player to the
// face they are standing on; the leading edge only ever meets what is in front.
function moveHorizontal(s, stepX, stepZ, world) {
    if (!world) {
        s.x += stepX;
        s.z += stepZ;
        return;
    }
    const feet = feetY(s);
    const low = feet + STEP_HEIGHT;
    const high = feet + BODY_HEIGHT;
    const lead = (v, d) => v + Math.sign(d) * HALF_WIDTH;

    if (stepX !== 0 && !world.blocked(lead(s.x + stepX, stepX), s.z, low, high, SKIN)) s.x += stepX;
    if (stepZ !== 0 && !world.blocked(s.x, lead(s.z + stepZ, stepZ), low, high, SKIN)) s.z += stepZ;
}
