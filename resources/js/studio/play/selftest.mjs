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
