export const GRAVITY = -196.2;
export const WALK_SPEED = 16;
export const JUMP_VELOCITY = 50;
export const MAX_DT = 0.033;
export const GROUND_SNAP_RATE = 16;
export const COYOTE_TIME = 0.12;
export const JUMP_BUFFER = 0.15;
export const VOID_Y = -500;
export const INPUT_EPSILON = 0.01;

export const TURN_EASE = 0.06;
export const SLOPE_LIMIT = Math.cos((45 * Math.PI) / 180);
export const SLIDE_FRICTION = 4;
export const SLIDE_STOP = 0.4;

export const BODY_HEIGHT = 5;
export const FEET_OFFSET = 2.64;
export const HALF_WIDTH = 1;
export const STEP_HEIGHT = 2;

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
        slideX: 0,
        slideZ: 0,
        sliding: false,
        grounded: false,
        coyote: 0,
        jumpBuffer: 0,
        speed: 0,
        moving: false,
        jumped: false,
        fell: false,
    };
}

export function feetY(s) {
    return s.y - FEET_OFFSET;
}

export function step(s, input, rawDt, world) {
    const dt = Math.min(rawDt, MAX_DT);
    s.jumped = false;
    s.fell = false;

    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    let dx = input.strafe * cos - input.forward * sin;
    let dz = -input.strafe * sin - input.forward * cos;

    if (dx * dx + dz * dz < INPUT_EPSILON) {
        s.vx = 0;
        s.vz = 0;
        s.speed = 0;
        s.moving = false;
    } else {
        const target = Math.atan2(dx, dz);
        s.heading = s.moving
            ? approachAngle(s.heading, target, 1 - Math.exp(-dt / TURN_EASE))
            : target;
        s.vx = Math.sin(s.heading) * WALK_SPEED;
        s.vz = Math.cos(s.heading) * WALK_SPEED;
        s.speed = WALK_SPEED;
        s.moving = true;
        s.yaw = Math.atan2(-s.vx, -s.vz);
        moveHorizontal(s, s.vx * dt, s.vz * dt, world);
    }

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
    if (steep) {
        const g = -GRAVITY * ground.ny;
        s.slideX += g * ground.nx * dt;
        s.slideZ += g * ground.nz * dt;
    } else {
        const decay = Math.exp(-dt * SLIDE_FRICTION);
        s.slideX *= decay;
        s.slideZ *= decay;
        if (Math.hypot(s.slideX, s.slideZ) < SLIDE_STOP) {
            s.slideX = 0;
            s.slideZ = 0;
        }
    }
    if (s.slideX !== 0 || s.slideZ !== 0) {
        moveHorizontal(s, s.slideX * dt, s.slideZ * dt, world);
    }

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

    if (target !== null && s.y <= target) {
        s.y = target;
        s.vy = 0;
        s.grounded = true;
        s.coyote = COYOTE_TIME;
    }

    if (s.y < VOID_Y) s.fell = true;
    return s;
}

const ground = { y: 0, nx: 0, ny: 1, nz: 0 };

function approachAngle(from, to, k) {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + d * k;
}

function moveHorizontal(s, stepX, stepZ, world) {
    if (!world) {
        s.x += stepX;
        s.z += stepZ;
        return;
    }
    const feet = feetY(s);
    const low = feet + STEP_HEIGHT;
    const high = feet + BODY_HEIGHT;

    if (stepX !== 0 && !world.blocked(s.x + stepX, s.z, low, high, HALF_WIDTH)) s.x += stepX;
    if (stepZ !== 0 && !world.blocked(s.x, s.z + stepZ, low, high, HALF_WIDTH)) s.z += stepZ;
}
