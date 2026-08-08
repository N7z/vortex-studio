import { buildWorld, spawnPoint } from './collision.js';
import * as move from './movement.js';

let failures = 0;
const check = (name, got, want, tol = 0.02) => {
    const ok = Math.abs(got - want) <= tol;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, want ${want}`);
};

const floor = [{ T: 'Part', P: [0, -1, 0], S: [512, 2, 512], R: [0, 0, 0] }];
const world = buildWorld(floor);

const run = (state, frames, input, dt = 1 / 240) => {
    for (let i = 0; i < frames; i++) move.step(state, input, dt, world);
    return state;
};

const idle = { forward: 0, strafe: 0, jump: false, yaw: 0 };

let s = move.spawn(0, 0, 0);
run(s, 240, idle);
check('rests on the floor', move.feetY(s), 0);
check('is grounded', s.grounded ? 1 : 0, 1, 0);

s = move.spawn(0, 0, 0);
run(s, 60, idle);
let peak = -Infinity;
move.step(s, { ...idle, jump: true }, 1 / 240, world);
for (let i = 0; i < 240; i++) {
    move.step(s, idle, 1 / 240, world);
    peak = Math.max(peak, move.feetY(s));
}
check('jump height', peak, 50 * 50 / (2 * 196.2), 0.15);

s = move.spawn(0, 0, 0);
run(s, 60, idle);
let apex = 0;
let t = 0;
for (let i = 0; i < 240; i++) {
    move.step(s, { ...idle, jump: i === 0 }, 1 / 240, world);
    t += 1 / 240;
    if (s.vy <= 0 && apex === 0) apex = t;
}
check('time to apex', apex, 50 / 196.2, 0.02);

const travelled = (input, frames) => {
    const p = move.spawn(0, 0, 0);
    run(p, 60, idle);
    const x0 = p.x;
    const z0 = p.z;
    run(p, frames, input);
    return Math.hypot(p.x - x0, p.z - z0);
};

const fwd = { forward: 1, strafe: 0, jump: false, yaw: 0 };
const diag = { forward: 1, strafe: 1, jump: false, yaw: 0 };
check('walk speed from a standstill', travelled(fwd, 240), 16, 0.01);
check('diagonal is not faster', travelled(diag, 240), 16, 0.01);

s = move.spawn(0, 0, 0);
run(s, 60, idle);
move.step(s, fwd, 1 / 240, world);
check('full speed on the first frame', s.speed, 16, 0.001);
move.step(s, idle, 1 / 240, world);
check('stops on the first frame', s.speed, 0, 0.001);

const deg = (a) => (a * 180) / Math.PI;
s = move.spawn(0, 0, 0);
run(s, 60, idle);
run(s, 240, fwd);
const h0 = s.heading;
move.step(s, diag, 1 / 240, world);
const afterOne = Math.abs(deg(s.heading - h0));
check('one frame does not snap to 45', afterOne < 5 ? 1 : 0, 1, 0);
check('speed is unchanged mid-turn', s.speed, 16, 0.001);
run(s, 60, diag);
check('heading settles at 45', Math.abs(deg(s.heading - h0)), 45, 1.5);

const stairs = [
    ...floor,
    { T: 'Part', P: [0, 1, -10], S: [8, 2, 8], R: [0, 0, 0] },
];
const stepWorld = buildWorld(stairs);
s = move.spawn(0, 0, 0);
for (let i = 0; i < 240; i++) move.step(s, idle, 1 / 240, stepWorld);
for (let i = 0; i < 150; i++) {
    move.step(s, { forward: 1, strafe: 0, jump: false, yaw: 0 }, 1 / 240, stepWorld);
}
check('walked up a 2-stud step', move.feetY(s), 2, 0.1);

const wall = [
    ...floor,
    { T: 'Part', P: [0, 10, -10], S: [40, 20, 4], R: [0, 0, 0] },
];
const wallWorld = buildWorld(wall);
s = move.spawn(0, 0, 0);
for (let i = 0; i < 240; i++) move.step(s, idle, 1 / 240, wallWorld);
for (let i = 0; i < 480; i++) {
    move.step(s, { forward: 1, strafe: 0, jump: false, yaw: 0 }, 1 / 240, wallWorld);
}
check('wall stops the player', s.z > -8.5 ? 1 : 0, 1, 0);

const ramp = buildWorld([{ T: 'Part', P: [0, 0, 0], S: [20, 2, 20], R: [0, 0, 30] }]);
const probe = { y: 0, nx: 0, ny: 1, nz: 0 };
check('rotated part has a surface', ramp.groundAt(0, 0, 10, 0.5, probe) ? 1 : 0, 1, 0);
check('rotated surface height', probe.y, 1 / Math.cos(30 * Math.PI / 180), 0.02);
check('surface normal is tilted 30', Math.acos(probe.ny) * 180 / Math.PI, 30, 0.5);

const slopeWorld = (angle) => buildWorld([
    { T: 'Part', P: [0, -1, 0], S: [400, 2, 400], R: [0, 0, 0] },
    { T: 'Part', P: [0, 20, 0], S: [120, 2, 60], R: [0, 0, angle] },
]);

const settleOn = (angle) => {
    const w = slopeWorld(angle);
    const g = { y: 0, nx: 0, ny: 1, nz: 0 };
    w.groundAt(0, 0, 200, 10, g);
    const p = move.spawn(0, g.y, 0);
    let everSliding = false;
    for (let i = 0; i < 480; i++) {
        move.step(p, idle, 1 / 240, w);
        everSliding = everSliding || p.sliding;
    }
    return { p, everSliding };
};

const gentle = settleOn(20);
check('gentle slope does not slide', Math.abs(gentle.p.x), 0, 0.3);
check('gentle slope never slides', gentle.everSliding ? 1 : 0, 0, 0);

const steep = settleOn(65);
check('steep slope slides', steep.everSliding ? 1 : 0, 1, 0);
check('steep slope slid the player off', Math.abs(steep.p.x) > 5 ? 1 : 0, 1, 0);
check('slide ends on flat ground', steep.p.sliding ? 1 : 0, 0, 0);

const walkUp = (angle) => {
    const w = slopeWorld(angle);
    const g = { y: 0, nx: 0, ny: 1, nz: 0 };
    w.groundAt(-50, 0, 200, -50, g);
    const p = move.spawn(-50, g.y, 0);
    for (let i = 0; i < 240; i++) move.step(p, idle, 1 / 240, w);
    const y0 = move.feetY(p);
    for (let i = 0; i < 240; i++) {
        move.step(p, { forward: 0, strafe: 1, jump: false, yaw: 0 }, 1 / 240, w);
    }
    return move.feetY(p) - y0;
};
check('walks up a 20 degree ramp', walkUp(20) > 3 ? 1 : 0, 1, 0);

const spawnParts = [...floor, { T: 'SpawnLocation', P: [7, 30, -3], S: [6, 1, 6], R: [0, 0, 0] }];
const sp = spawnPoint(spawnParts, buildWorld(spawnParts));
check('spawn x', sp[0], 7, 0);
check('spawn top', sp[1], 30.5, 0);

const manySpawns = [
    ...floor,
    { T: 'SpawnLocation', P: [0, 1, 0], S: [6, 1, 6], R: [0, 0, 0] },
    { T: 'SpawnLocation', P: [40, 1, 0], S: [6, 1, 6], R: [0, 0, 0] },
    { T: 'SpawnLocation', P: [80, 1, 0], S: [6, 1, 6], R: [0, 0, 0] },
];
const spawnWorld = buildWorld(manySpawns);
check('spawn picks the one it is told to', spawnPoint(manySpawns, spawnWorld, () => 2)[0], 80, 0);
const landedOn = new Set();
for (let i = 0; i < 200; i++) landedOn.add(spawnPoint(manySpawns, spawnWorld)[0]);
check('random spawn reaches every point', landedOn.size, 3, 0);

// --- CanCollide ---

const ghostParts = [...floor, { T: 'Part', P: [0, 10, -10], S: [40, 20, 4], R: [0, 0, 0], Cc: false }];
const ghostWorld = buildWorld(ghostParts);
s = move.spawn(0, 0, 0);
run(s, 240, idle);
run(s, 480, fwd);
check('a CanCollide=false wall does not block', s.z < -20 ? 1 : 0, 1, 0);
check('a CanCollide=false part is not ground', ghostWorld.groundAt(0, -10, 40, 10, probe) ? 1 : 0, 0, 0);

// --- ceilings ---

// A standing player occupies feet..feet+5, so a ceiling has to clear that to be a
// ceiling at all; an unobstructed jump takes the head to 11.37.
const roofAt = (y, thickness = 1) => buildWorld([
    ...floor,
    { T: 'Part', P: [0, y, 0], S: [20, thickness, 20], R: [0, 0, 0] },
]);

const lowRoof = roofAt(8);
s = move.spawn(0, 0, 0);
run(s, 240, idle);
let bumped = false;
let peakHead = -Infinity;
for (let i = 0; i < 240; i++) {
    move.step(s, { ...idle, jump: i === 0 }, 1 / 240, lowRoof);
    bumped = bumped || s.bumped;
    peakHead = Math.max(peakHead, move.headY(s));
}
check('the head stops at the ceiling', peakHead, 7.5, 0.05);
check('the bump is reported', bumped ? 1 : 0, 1, 0);
check('the player falls back to the floor', move.feetY(s), 0, 0.02);

// Without the ceiling the same jump goes well past it.
s = move.spawn(0, 0, 0);
run(s, 240, idle);
let freeHead = -Infinity;
for (let i = 0; i < 240; i++) {
    move.step(s, { ...idle, jump: i === 0 }, 1 / 240, world);
    freeHead = Math.max(freeHead, move.headY(s));
}
check('the same jump is unobstructed without one', freeHead > 11 ? 1 : 0, 1, 0);

// The jump must not end with the player standing on the roof.
s = move.spawn(0, 0, 0);
run(s, 240, idle);
for (let i = 0; i < 480; i++) move.step(s, { ...idle, jump: i === 0 }, 1 / 240, lowRoof);
check('a jump does not pop through a platform', move.feetY(s), 0, 0.05);

// Standing on top of one is still standing on top of one.
s = move.spawn(0, 8.5, 0);
for (let i = 0; i < 480; i++) move.step(s, idle, 1 / 240, lowRoof);
check('the top of a platform still holds', move.feetY(s), 8.5, 0.02);

// A ceiling never grounds the player.
s = move.spawn(0, 0, 0);
run(s, 240, idle);
let groundedAtBump = false;
for (let i = 0; i < 240; i++) {
    move.step(s, { ...idle, jump: i === 0 }, 1 / 240, lowRoof);
    if (s.bumped) groundedAtBump = groundedAtBump || s.grounded;
}
check('a bump does not ground the player', groundedAtBump ? 1 : 0, 0, 0);

// --- the residual channel ---
// Grounded, the client clears the residual every frame, so these run in the air.

const airborne = (set) => {
    const p = move.spawn(0, 400, 0);
    move.step(p, idle, 1 / 240, world);
    set(p);
    move.step(p, idle, 1 / 60, world);
    return p;
};

check('residual decays by 1 - 2.5dt', airborne((p) => { p.residualX = 40; }).residualX,
    40 * (1 - 2.5 / 60), 0.01);
check('residual under 0.3 snaps to zero', airborne((p) => { p.residualX = 0.2; }).residualX, 0, 0);
check('with a speed override it steps by 142',
    airborne((p) => { p.residualX = 300; p.speedOverride = 1; }).residualX, 300 - 142 / 60, 0.01);

// residual + wish is capped once, so a tailwind cannot be walked into overspeed
s = move.spawn(0, 400, 0);
s.residualX = 12;
move.step(s, { forward: 1, strafe: 0, jump: false, yaw: 0 }, 1 / 240, world);
check('walking with a residual stays under the cap', s.speed, 16, 0.001);

// but a big residual with an override raises the cap to its own magnitude
s = move.spawn(0, 400, 0);
s.residualX = 60;
s.speedOverride = 1;
move.step(s, idle, 1 / 240, world);
check('an override lets the residual keep its speed', s.speed, 60, 0.01);

// --- landing ---

s = move.spawn(0, 20, 0);
let landed = false;
for (let i = 0; i < 480; i++) {
    move.step(s, idle, 1 / 240, world);
    landed = landed || s.landed;
}
check('landing is reported once the fall ends', landed ? 1 : 0, 1, 0);

s = move.spawn(0, 20, 0);
s.residualX = 30;
for (let i = 0; i < 480; i++) move.step(s, idle, 1 / 240, world);
check('landing clears the residual', s.residualX, 0, 0);

// --- what the camera raycast sees ---

const wallWorld2 = buildWorld([
    ...floor,
    { T: 'Part', P: [0, 10, -20], S: [60, 20, 4], R: [0, 0, 0] },
]);
const from = { x: 0, y: 5, z: 0 };
check('the ray finds the wall behind the player',
    wallWorld2.rayHit(from, { x: 0, y: 0, z: -1 }, 40), 18, 0.01);
check('the ray stops at its limit',
    wallWorld2.rayHit(from, { x: 0, y: 0, z: -1 }, 10) === null ? 1 : 0, 1, 0);
check('nothing behind means nothing to pull in to',
    wallWorld2.rayHit(from, { x: 0, y: 0, z: 1 }, 40) === null ? 1 : 0, 1, 0);
check('the floor is in the way when looking down',
    wallWorld2.rayHit(from, { x: 0, y: -1, z: 0 }, 40), 5, 0.01);
check('a CanCollide=false part is invisible to the camera too',
    buildWorld([{ T: 'Part', P: [0, 10, -20], S: [60, 20, 4], R: [0, 0, 0], Cc: false }])
        .rayHit(from, { x: 0, y: 0, z: -1 }, 40) === null ? 1 : 0, 1, 0);

const big = [];
for (let i = 0; i < 20000; i++) {
    big.push({ T: 'Part', P: [(i % 141) * 8 - 560, (i % 7) * 4, Math.floor(i / 141) * 8 - 560], S: [8, 2, 8], R: [0, 0, 0] });
}
let t0 = performance.now();
const bigWorld = buildWorld(big);
const buildMs = performance.now() - t0;
s = move.spawn(0, 40, 0);
t0 = performance.now();
for (let i = 0; i < 10000; i++) {
    move.step(s, { forward: 1, strafe: 0.3, jump: i % 90 === 0, yaw: i * 0.001 }, 1 / 240, bigWorld);
}
const stepUs = ((performance.now() - t0) * 1000) / 10000;
console.log(`\n20000 parts: build ${buildMs.toFixed(1)} ms, ${bigWorld.cells} cells, ${stepUs.toFixed(2)} us/frame`);
if (stepUs > 50) { console.log('FAIL  step is too slow'); failures++; }

console.log(failures ? `\n${failures} failing` : '\nall good');
process.exit(failures ? 1 : 0);
