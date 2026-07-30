import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { WebSocket } from 'ws';

import {
    addOp, applyOp, invertOp, patchOp, removeOp, transformOp,
} from '../../resources/js/studio/ops.js';
import { createLiveServer } from '../src/server.js';

let live;
let port;

before(async () => {
    live = createLiveServer();
    port = await live.listen(0);
});

after(async () => {
    await live.close();
});

const base = (over = {}) => ({
    T: 'Part', P: [0, 0, 0], S: [4, 2, 4], R: [0, 0, 0], C: 'a3a2a5', Tr: 0, ...over,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

let tabs = 0;

class Editor {
    constructor() {
        this.tag = `tab${++tabs}`;
        this.seq = 0;
        this.parts = [];
        this.history = [];
        this.future = [];
        this.me = null;
        this.role = 'spectator';
        this.errors = [];
        this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
        this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
        this.ws.on('open', () => this.onOpen?.());
        this.ws.on('message', (raw) => this.receive(JSON.parse(raw.toString())));
    }

    static async open(parts) {
        const e = new Editor();
        e.onOpen = () => e.send({ t: 'create', mapName: 'shared', parts });
        await e.ready;

        return e;
    }

    static async join(code) {
        const e = new Editor();
        e.onOpen = () => e.send({ t: 'join', code });
        await e.ready;

        return e;
    }

    receive(msg) {
        switch (msg.t) {
            case 'welcome':
                this.code = msg.code;
                this.me = msg.you.id;
                this.role = msg.you.owner ? 'developer' : msg.you.role;
                this.parts = msg.parts;
                this.resolveReady();
                break;
            case 'you':
                this.role = msg.role;
                break;
            case 'op':
                this.parts = applyOp(this.parts, msg.op);
                break;
            case 'snapshot':
                this.parts = msg.parts;
                this.history = [];
                this.future = [];
                break;
            case 'error':
                this.errors.push(msg.message);
                break;
            default:
                break;
        }
    }

    send(msg) {
        this.ws.send(JSON.stringify(msg));
    }

    edit(op) {
        const before = this.parts;
        const next = applyOp(before, op);
        if (next === before) return;
        const inverse = invertOp(before, op);
        if (inverse) {
            this.history.push(inverse);
            this.future = [];
        }
        this.parts = next;
        this.send({ t: 'op', op });
    }

    step(from, to) {
        const op = this[from].pop();
        if (!op) return;
        const before = this.parts;
        const next = applyOp(before, op);
        if (next === before) return;
        const inverse = invertOp(before, op);
        if (inverse) this[to].push(inverse);
        this.parts = next;
        this.send({ t: 'op', op });
    }

    undo() {
        this.step('history', 'future');
    }

    redo() {
        this.step('future', 'history');
    }

    add(over) {
        this.seq += 1;
        const p = { ...base(over), _id: `${this.tag}-${this.seq}` };
        this.edit(addOp([p]));

        return p._id;
    }

    ids() {
        return this.parts.map((p) => p._id);
    }

    part(id) {
        return this.parts.find((p) => p._id === id);
    }
}

async function room(hostParts = []) {
    const a = await Editor.open(hostParts);
    const b = await Editor.join(a.code);
    a.send({ t: 'role', memberId: b.me, role: 'developer' });
    await settle();
    assert.equal(b.role, 'developer');

    return { a, b };
}

const shut = (...editors) => editors.forEach((e) => e.ws.close());

test('two editors adding parts at the same time converge on the same map', async () => {
    const { a, b } = await room();

    a.add({ C: 'ff0000' });
    b.add({ C: '00ff00' });
    a.add({ C: '0000ff' });
    await settle();

    assert.equal(a.parts.length, 3);
    assert.deepEqual(a.ids(), b.ids());
    assert.deepEqual(a.parts, b.parts);
    shut(a, b);
});

test('ids minted in different tabs never collide', async () => {
    const { a, b } = await room();
    for (let i = 0; i < 20; i++) {
        a.add();
        b.add();
    }
    await settle();

    assert.equal(new Set(a.ids()).size, 40);
    assert.deepEqual(a.ids(), b.ids());
    shut(a, b);
});

test('editing different parts at the same time keeps both edits', async () => {
    const { a, b } = await room();
    const left = a.add();
    const right = a.add();
    await settle();

    a.edit(patchOp([left], { C: '112233' }));
    b.edit(transformOp([{ id: right, P: [9, 9, 9] }]));
    await settle();

    assert.equal(a.part(left).C, '112233');
    assert.deepEqual(a.part(right).P, [9, 9, 9]);
    assert.deepEqual(a.parts, b.parts);
    shut(a, b);
});

test('editing the same part at the same time settles on one value for both', async () => {
    const { a, b } = await room();
    const id = a.add();
    await settle();

    a.edit(patchOp([id], { C: 'aaaaaa' }));
    b.edit(patchOp([id], { C: 'bbbbbb' }));
    await settle();

    assert.equal(a.part(id).C, b.part(id).C);
    assert.deepEqual(a.parts, b.parts);
    shut(a, b);
});

test('an edit to a part someone else deleted is dropped by everyone alike', async () => {
    const { a, b } = await room();
    const id = a.add();
    await settle();

    a.edit(removeOp([id]));
    b.edit(patchOp([id], { C: 'cccccc' }));
    await settle();

    assert.deepEqual(a.ids(), []);
    assert.deepEqual(b.ids(), []);
    shut(a, b);
});

test('undo reverts only your own last edit, not the other persons', async () => {
    const { a, b } = await room();
    const mine = a.add({ C: '111111' });
    await settle();
    const theirs = b.add({ C: '222222' });
    await settle();

    a.undo();
    await settle();

    assert.deepEqual(a.ids(), [theirs]);
    assert.deepEqual(b.ids(), [theirs]);
    assert.equal(b.part(theirs).C, '222222');
    shut(a, b);
});

test('undo of a move restores your position without disturbing theirs', async () => {
    const { a, b } = await room();
    const mine = a.add();
    const theirs = b.add();
    await settle();

    a.edit(transformOp([{ id: mine, P: [5, 0, 5] }]));
    b.edit(transformOp([{ id: theirs, P: [7, 0, 7] }]));
    await settle();

    a.undo();
    await settle();

    assert.deepEqual(a.part(mine).P, [0, 0, 0]);
    assert.deepEqual(a.part(theirs).P, [7, 0, 7]);
    assert.deepEqual(a.parts, b.parts);
    shut(a, b);
});

test('redo replays what undo took back, for both editors', async () => {
    const { a, b } = await room();
    const id = a.add();
    await settle();

    a.edit(patchOp([id], { C: 'dddddd' }));
    await settle();
    a.undo();
    await settle();
    assert.equal(b.part(id).C, 'a3a2a5');

    a.redo();
    await settle();
    assert.equal(a.part(id).C, 'dddddd');
    assert.equal(b.part(id).C, 'dddddd');
    shut(a, b);
});

test('undoing a delete puts the part back where it was in the list', async () => {
    const { a, b } = await room();
    const first = a.add();
    const middle = a.add();
    const last = a.add();
    await settle();

    a.edit(removeOp([middle]));
    await settle();
    assert.deepEqual(b.ids(), [first, last]);

    a.undo();
    await settle();
    assert.deepEqual(a.ids(), [first, middle, last]);
    assert.deepEqual(b.ids(), [first, middle, last]);
    shut(a, b);
});

test('a spectator that tries to edit is put back in step with the room', async () => {
    const a = await Editor.open([]);
    const b = await Editor.join(a.code);
    const id = a.add();
    await settle();

    b.edit(patchOp([id], { C: 'eeeeee' }));
    await settle();

    assert.ok(b.errors.some((m) => /spectator/.test(m)));
    assert.deepEqual(b.parts, a.parts);
    assert.equal(b.part(id).C, 'a3a2a5');
    shut(a, b);
});

test('a long interleaved session leaves both editors byte for byte identical', async () => {
    const { a, b } = await room();
    const mine = [];
    const theirs = [];

    for (let i = 0; i < 12; i++) {
        mine.push(a.add({ P: [i, 0, 0] }));
        theirs.push(b.add({ P: [0, 0, i] }));
        if (i % 3 === 0) a.edit(patchOp([mine[i]], { C: '445566' }));
        if (i % 4 === 0) b.edit(transformOp([{ id: theirs[i], R: [0, 90, 0] }]));
        if (i % 5 === 0 && i) a.edit(removeOp([mine[i - 1]]));
        if (i % 6 === 0) a.undo();
        await settle();
    }
    await settle();

    assert.deepEqual(a.parts, b.parts);
    assert.equal(a.errors.length, 0);
    assert.equal(b.errors.length, 0);
    shut(a, b);
});
