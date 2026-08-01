import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

process.env.OWNER_GRACE_SECONDS = '1';
process.env.LIVE_SECRET = 'test-secret';
const { createLiveServer } = await import('../src/server.js');

let live;
let port;

before(async () => {
    live = createLiveServer();
    port = await live.listen(0);
});

after(async () => {
    await live.close();
});

const part = (id, over = {}) => ({
    _id: id, T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0], ...over,
});

class Client {
    constructor() {
        this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
        this.inbox = [];
        this.waiters = [];
        this.closed = new Promise((resolve) => this.ws.on('close', (code) => resolve(code)));
        this.ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            const waiter = this.waiters.find((w) => w.match(msg));
            if (waiter) {
                this.waiters.splice(this.waiters.indexOf(waiter), 1);
                waiter.resolve(msg);
                return;
            }
            this.inbox.push(msg);
        });
        this.open = new Promise((resolve, reject) => {
            this.ws.on('open', resolve);
            this.ws.on('error', reject);
        });
    }

    send(msg) {
        this.ws.send(JSON.stringify(msg));
        return this;
    }

    next(type, extra = () => true) {
        const match = (m) => m.t === type && extra(m);
        const found = this.inbox.find(match);
        if (found) {
            this.inbox.splice(this.inbox.indexOf(found), 1);
            return Promise.resolve(found);
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2000);
            this.waiters.push({
                match,
                resolve: (m) => {
                    clearTimeout(timer);
                    resolve(m);
                },
            });
        });
    }

    drop(type) {
        this.inbox = this.inbox.filter((m) => m.t !== type);
    }
}

async function host(parts = [part('a')], groups) {
    const c = new Client();
    await c.open;
    c.send({ t: 'create', mapName: 'testmap', parts, groups });
    const welcome = await c.next('welcome');

    return { c, welcome };
}

async function guest(code, token) {
    const c = new Client();
    await c.open;
    c.send({ t: 'join', code, token });
    const welcome = await c.next('welcome');

    return { c, welcome };
}

test('creating a room makes the caller the owner and a developer', async () => {
    const { c, welcome } = await host();
    assert.match(welcome.code, /^[A-Z0-9]{6}$/);
    assert.equal(welcome.mapName, 'testmap');
    assert.equal(welcome.you.owner, true);
    assert.equal(welcome.you.role, 'developer');
    assert.match(welcome.you.name, /^\w+ \w+$/);
    assert.deepEqual(welcome.parts.map((p) => p._id), ['a']);
    c.ws.close();
});

test('a joiner gets the current map and lands as a spectator', async () => {
    const { c: owner, welcome: hi } = await host([part('a'), part('b')]);
    const { c: other, welcome } = await guest(hi.code);

    assert.equal(welcome.you.owner, false);
    assert.equal(welcome.you.role, 'spectator');
    assert.deepEqual(welcome.parts.map((p) => p._id), ['a', 'b']);
    assert.equal(welcome.members.length, 2);
    assert.notEqual(welcome.you.color, hi.you.color);
    assert.notEqual(welcome.you.name, hi.you.name);

    owner.ws.close();
    other.ws.close();
});

test('joining an unknown code is refused', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'join', code: 'ZZZZZZ' });
    assert.match((await c.next('error')).message, /no live session/);
    c.ws.close();
});

test('the code a user types is normalised before lookup', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(` ${hi.code.toLowerCase()} `);
    assert.equal(welcome.code, hi.code);
    owner.ws.close();
    other.ws.close();
});

test('an op from the owner reaches everyone, sender included', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);

    const op = { t: 'add', items: [{ part: part('b') }] };
    owner.send({ t: 'op', op });

    const mine = await owner.next('op');
    const theirs = await other.next('op');
    assert.equal(mine.seq, 1);
    assert.equal(theirs.seq, 1);
    assert.equal(mine.from, hi.you.id);
    assert.deepEqual(theirs.op, op);

    owner.ws.close();
    other.ws.close();
});

test('a spectator cannot edit and is resynced when it tries', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);

    other.send({ t: 'op', op: { t: 'add', items: [{ part: part('b') }] } });
    assert.match((await other.next('error')).message, /spectator/);
    const snap = await other.next('snapshot');
    assert.deepEqual(snap.parts.map((p) => p._id), ['a']);

    owner.ws.close();
    other.ws.close();
});

test('a promoted developer can edit, and a demoted one cannot', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);

    owner.send({ t: 'role', memberId: welcome.you.id, role: 'developer' });
    assert.equal((await other.next('you')).role, 'developer');

    other.send({ t: 'op', op: { t: 'add', items: [{ part: part('b') }] } });
    assert.equal((await other.next('op')).seq, 1);

    owner.send({ t: 'role', memberId: welcome.you.id, role: 'spectator' });
    assert.equal((await other.next('you')).role, 'spectator');

    other.send({ t: 'op', op: { t: 'add', items: [{ part: part('c') }] } });
    assert.match((await other.next('error')).message, /spectator/);

    owner.ws.close();
    other.ws.close();
});

test('only the owner may change roles or kick', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);

    other.send({ t: 'role', memberId: hi.you.id, role: 'spectator' });
    assert.match((await other.next('error')).message, /only the room owner/);

    other.send({ t: 'kick', memberId: hi.you.id });
    assert.match((await other.next('error')).message, /only the room owner/);

    owner.send({ t: 'role', memberId: hi.you.id, role: 'spectator' });
    assert.match((await owner.next('error')).message, /owner is always a developer/);

    owner.send({ t: 'kick', memberId: welcome.you.id });
    assert.equal(await other.closed, 4003);

    owner.ws.close();
});

test('a kicked member is told why before the socket closes', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);

    owner.send({ t: 'kick', memberId: welcome.you.id });
    assert.match((await other.next('kicked')).reason, /removed you/);
    await other.closed;

    const members = await owner.next('members', (m) => m.members.length === 1);
    assert.equal(members.members[0].id, hi.you.id);

    owner.ws.close();
});

test('a kicked member cannot come back with the token it still holds', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);
    owner.send({ t: 'role', memberId: welcome.you.id, role: 'developer' });
    await other.next('you');

    owner.send({ t: 'kick', memberId: welcome.you.id });
    assert.equal(await other.closed, 4003);

    const back = new Client();
    await back.open;
    back.send({ t: 'join', code: hi.code, token: welcome.you.token });
    assert.match((await back.next('error')).message, /removed you/);
    assert.equal(await back.closed, 4004);

    owner.ws.close();
});

test('only the owner may replace the whole map', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);
    owner.send({ t: 'role', memberId: welcome.you.id, role: 'developer' });
    await other.next('you');

    other.send({ t: 'op', op: { t: 'replace', parts: [part('z')] } });
    assert.match((await other.next('error')).message, /only the room owner/);

    owner.send({ t: 'op', op: { t: 'replace', parts: [part('z')] } });
    assert.equal((await other.next('op')).op.t, 'replace');

    owner.ws.close();
    other.ws.close();
});

test('a malformed op is refused without touching the room', async () => {
    const { c: owner } = await host();

    owner.send({ t: 'op', op: { t: 'add', items: [{ part: { _id: 'x' } }] } });
    assert.match((await owner.next('error')).message, /bad part data/);
    const snap = await owner.next('snapshot');
    assert.deepEqual(snap.parts.map((p) => p._id), ['a']);

    owner.ws.close();
});

test('selections are relayed to the others but not echoed back', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);

    owner.send({ t: 'selection', ids: ['a'] });
    const seen = await other.next('selection');
    assert.equal(seen.id, hi.you.id);
    assert.deepEqual(seen.selection, ['a']);
    assert.equal(owner.inbox.some((m) => m.t === 'selection'), false);

    owner.ws.close();
    other.ws.close();
});

test('a spectator selection is not relayed', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);
    owner.drop('members');

    other.send({ t: 'selection', ids: ['a'] });
    other.send({ t: 'ping' });
    await other.next('pong');
    assert.equal(owner.inbox.some((m) => m.t === 'selection'), false);

    owner.ws.close();
    other.ws.close();
});

test('demoting a developer clears the selection others can see', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);
    owner.send({ t: 'role', memberId: welcome.you.id, role: 'developer' });
    await other.next('you');

    other.send({ t: 'selection', ids: ['a'] });
    await owner.next('selection');

    owner.drop('members');
    owner.send({ t: 'role', memberId: welcome.you.id, role: 'spectator' });
    const members = await owner.next('members');
    assert.deepEqual(members.members.find((m) => m.id === welcome.you.id).selection, []);

    owner.ws.close();
    other.ws.close();
});

test('ownership passes to the next member once the owner stays away', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);

    owner.ws.close();
    const you = await other.next('you');
    assert.equal(you.owner, true);
    assert.equal(you.role, 'developer');

    const members = await other.next('members', (m) => m.ownerId === welcome.you.id);
    assert.equal(members.members.length, 1);

    other.send({ t: 'op', op: { t: 'add', items: [{ part: part('b') }] } });
    assert.equal((await other.next('op')).seq, 1);

    other.ws.close();
});

test('an owner who reconnects in time keeps the room, its name and its colour', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);

    owner.ws.close();
    await owner.closed;
    const { c: back, welcome } = await guest(hi.code, hi.you.token);

    assert.equal(welcome.resumed, true);
    assert.equal(welcome.you.owner, true);
    assert.equal(welcome.you.id, hi.you.id);
    assert.equal(welcome.you.name, hi.you.name);
    assert.equal(welcome.you.color, hi.you.color);
    assert.equal(welcome.members.length, 2);

    back.send({ t: 'op', op: { t: 'add', items: [{ part: part('b') }] } });
    assert.equal((await back.next('op')).seq, 1);
    assert.equal(other.inbox.some((m) => m.t === 'you' && m.owner), false);

    back.ws.close();
    other.ws.close();
});

test('a transferred room is not taken back by the returning owner', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome: theirs } = await guest(hi.code);

    owner.ws.close();
    await other.next('you', (m) => m.owner);

    const { c: back, welcome } = await guest(hi.code, hi.you.token);
    assert.equal(welcome.resumed, true);
    assert.equal(welcome.you.owner, false);
    assert.equal(welcome.members.find((m) => m.owner).id, theirs.you.id);

    back.ws.close();
    other.ws.close();
});

test('a rejoining member keeps the role it was granted', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome: theirs } = await guest(hi.code);

    owner.send({ t: 'role', memberId: theirs.you.id, role: 'developer' });
    await other.next('you');
    other.ws.close();
    await other.closed;

    const { c: back, welcome } = await guest(hi.code, theirs.you.token);
    assert.equal(welcome.you.role, 'developer');
    back.send({ t: 'op', op: { t: 'add', items: [{ part: part('b') }] } });
    assert.equal((await back.next('op')).seq, 1);

    owner.ws.close();
    back.ws.close();
});

test('an unknown resume token is treated as a fresh join', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code, 'not-a-real-token');

    assert.equal(welcome.resumed, false);
    assert.equal(welcome.you.role, 'spectator');
    assert.notEqual(welcome.you.id, hi.you.id);

    owner.ws.close();
    other.ws.close();
});

test('the room and its edits survive everyone reconnecting', async () => {
    const { c: owner, welcome: hi } = await host();
    owner.send({ t: 'op', op: { t: 'add', items: [{ part: part('b') }] } });
    await owner.next('op');
    owner.ws.close();
    await owner.closed;

    const { c: back, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.parts.map((p) => p._id), ['a', 'b']);
    assert.equal(welcome.you.owner, true);
    back.ws.close();
});

test('an owner save is announced to the room', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);

    owner.send({ t: 'saved' });
    assert.ok((await other.next('saved')).at > 0);

    other.send({ t: 'saved' });
    other.send({ t: 'ping' });
    await other.next('pong');
    assert.equal(other.inbox.some((m) => m.t === 'saved'), false);

    owner.ws.close();
    other.ws.close();
});

test('resync hands back the authoritative map', async () => {
    const { c: owner } = await host();
    owner.send({ t: 'op', op: { t: 'add', items: [{ part: part('b'), at: 0 }] } });
    await owner.next('op');

    owner.send({ t: 'resync' });
    const snap = await owner.next('snapshot');
    assert.deepEqual(snap.parts.map((p) => p._id), ['b', 'a']);
    assert.equal(snap.seq, 1);

    owner.ws.close();
});

test('messages before joining are refused', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'op', op: { t: 'remove', ids: ['a'] } });
    assert.match((await c.next('error')).message, /join a session first/);
    c.ws.close();
});

test('creating a room with bad input is refused and the socket is closed', async () => {
    const cases = [
        [{ mapName: 'has spaces', parts: [] }, /bad map name/],
        [{ mapName: 'ok', parts: [part('a'), part('a')] }, /bad map data/],
        [{ mapName: 'ok', parts: 'nope' }, /bad map data/],
    ];
    for (const [body, expected] of cases) {
        const c = new Client();
        await c.open;
        c.send({ t: 'create', ...body });
        assert.match((await c.next('error')).message, expected);
        assert.equal(await c.closed, 4004);
    }
});

test('a refused join closes the socket instead of leaving it open', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'join', code: 'ZZZZZZ' });
    assert.match((await c.next('error')).message, /no live session/);
    assert.equal(await c.closed, 4004);
});

test('the folders the host brings reach a joiner', async () => {
    const groups = [{ id: 'g-1', name: 'Walls', ids: ['a', 'b'] }];
    const { c: owner, welcome: hi } = await host([part('a'), part('b')], groups);
    const { c: other, welcome } = await guest(hi.code);

    assert.deepEqual(hi.groups, groups);
    assert.deepEqual(welcome.groups, groups);
    owner.ws.close();
    other.ws.close();
});

test('a folder change is relayed to the others but not echoed back', async () => {
    const { c: owner, welcome: hi } = await host([part('a'), part('b')]);
    const { c: other } = await guest(hi.code);

    const groups = [{ id: 'g-1', name: 'Roof', ids: ['b'] }];
    owner.send({ t: 'groups', groups });

    assert.deepEqual((await other.next('groups')).groups, groups);
    assert.equal(owner.inbox.some((m) => m.t === 'groups'), false);

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, groups);

    owner.ws.close();
    other.ws.close();
    late.ws.close();
});

test('a spectator cannot change the folders', async () => {
    const { c: owner, welcome: hi } = await host([part('a')]);
    const { c: other } = await guest(hi.code);

    other.send({ t: 'groups', groups: [{ id: 'g-1', name: 'Nope', ids: ['a'] }] });
    assert.match((await other.next('error')).message, /spectator/);

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, []);

    owner.ws.close();
    other.ws.close();
    late.ws.close();
});

test('deleting a part drops it from the folders, and an empty folder goes', async () => {
    const groups = [
        { id: 'g-1', name: 'Pair', ids: ['a', 'b'] },
        { id: 'g-2', name: 'Lonely', ids: ['c'] },
    ];
    const { c: owner, welcome: hi } = await host([part('a'), part('b'), part('c')], groups);

    owner.send({ t: 'op', op: { t: 'remove', ids: ['b', 'c'] } });
    await owner.next('op');

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, [{ id: 'g-1', name: 'Pair', ids: ['a'] }]);

    owner.ws.close();
    late.ws.close();
});

test('bad folder data is refused', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'create', mapName: 'testmap', parts: [part('a')], groups: [{ id: 'g-1' }] });
    assert.match((await c.next('error')).message, /bad group data/);
    assert.equal(await c.closed, 4004);

    const { c: owner } = await host([part('a')]);
    owner.send({ t: 'groups', groups: 'nope' });
    assert.match((await owner.next('error')).message, /bad group data/);
    owner.ws.close();
});

test('a view is relayed to the others but not echoed back', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other } = await guest(hi.code);

    const view = { p: [1, 2, 3], d: [0, 0, -1] };
    owner.send({ t: 'view', view });

    assert.deepEqual((await other.next('view')).view, view);
    assert.equal(owner.inbox.some((m) => m.t === 'view'), false);

    owner.ws.close();
    other.ws.close();
});

test('a joiner sees where the people already there are looking from', async () => {
    const { c: owner, welcome: hi } = await host();
    const view = { p: [10, 5, 0], d: [1, 0, 0] };
    owner.send({ t: 'view', view });

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.members.find((m) => m.id === hi.you.id).view, view);

    owner.ws.close();
    late.ws.close();
});

test('a spectator is visible too, and a bad view is ignored', async () => {
    const { c: owner, welcome: hi } = await host();
    const { c: other, welcome } = await guest(hi.code);

    const view = { p: [0, 1, 0], d: [0, -1, 0] };
    other.send({ t: 'view', view });
    assert.deepEqual((await owner.next('view')).view, view);

    other.send({ t: 'view', view: { p: [0, 1], d: [0, 0, 1] } });
    other.send({ t: 'view', view: { p: [0, 'x', 0], d: [0, 0, 1] } });
    other.send({ t: 'ping' });
    await other.next('pong');

    const { c: late, welcome: seen } = await guest(hi.code);
    assert.deepEqual(seen.members.find((m) => m.id === welcome.you.id).view, view);

    owner.ws.close();
    other.ws.close();
    late.ws.close();
});

test('garbage and unknown message types are reported, not fatal', async () => {
    const { c: owner } = await host();
    owner.ws.send('{not json');
    assert.match((await owner.next('error')).message, /malformed/);
    owner.send({ t: 'whatever' });
    assert.match((await owner.next('error')).message, /unknown message/);
    owner.send({ t: 'ping' });
    await owner.next('pong');
    owner.ws.close();
});

test('a group naming a part the room does not hold loses that member', async () => {
    const groups = [{ id: 'g-1', name: 'Pair', ids: ['a', 'ghost'] }];
    const { c: owner, welcome: hi } = await host([part('a')], groups);

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, [{ id: 'g-1', name: 'Pair', ids: ['a'] }]);

    owner.ws.close();
    late.ws.close();
});

test('a part claimed by two folders is refused', async () => {
    const { c: owner } = await host([part('a')]);
    owner.send({
        t: 'groups',
        groups: [{ id: 'g-1', name: 'A', ids: ['a'] }, { id: 'g-2', name: 'B', ids: ['a'] }],
    });
    assert.match((await owner.next('error')).message, /bad group data/);
    owner.ws.close();
});

test('a group op is broadcast with a seq to everyone, sender included', async () => {
    const { c: owner, welcome: hi } = await host([part('a'), part('b')]);
    const { c: other } = await guest(hi.code);

    const op = { t: 'group', id: 'g-1', name: 'Pair', ids: ['a', 'b'] };
    owner.send({ t: 'gop', op });

    const mine = await owner.next('gop');
    const theirs = await other.next('gop');
    assert.equal(mine.seq, 1);
    assert.equal(mine.from, hi.you.id);
    assert.deepEqual(theirs.op, op);

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, [{ id: 'g-1', name: 'Pair', ids: ['a', 'b'] }]);

    owner.ws.close();
    other.ws.close();
    late.ws.close();
});

test('two developers grouping at once keep both folders', async () => {
    const { c: owner, welcome: hi } = await host([part('a'), part('b'), part('c'), part('d')]);
    const { c: other, welcome: you } = await guest(hi.code);
    owner.send({ t: 'role', memberId: you.you.id, role: 'developer' });
    await other.next('you');

    owner.send({ t: 'gop', op: { t: 'group', id: 'g-1', name: 'Left', ids: ['a', 'b'] } });
    other.send({ t: 'gop', op: { t: 'group', id: 'g-2', name: 'Right', ids: ['c', 'd'] } });
    await owner.next('gop', (m) => m.seq === 2);
    await other.next('gop', (m) => m.seq === 2);

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups.map((g) => g.id).sort(), ['g-1', 'g-2']);

    owner.ws.close();
    other.ws.close();
    late.ws.close();
});

test('a group op re-applied is the same as applied once', async () => {
    const { c: owner, welcome: hi } = await host([part('a'), part('b')]);
    const op = { t: 'group', id: 'g-1', name: 'Pair', ids: ['a', 'b'] };

    owner.send({ t: 'gop', op });
    await owner.next('gop');
    owner.send({ t: 'gop', op });
    await owner.next('gop');

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, [{ id: 'g-1', name: 'Pair', ids: ['a', 'b'] }]);

    owner.ws.close();
    late.ws.close();
});

test('grouping a part takes it out of the folder it was in', async () => {
    const groups = [{ id: 'g-1', name: 'Both', ids: ['a', 'b'] }];
    const { c: owner, welcome: hi } = await host([part('a'), part('b')], groups);

    owner.send({ t: 'gop', op: { t: 'group', id: 'g-2', name: 'Just b', ids: ['b'] } });
    await owner.next('gop');

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, [
        { id: 'g-1', name: 'Both', ids: ['a'] },
        { id: 'g-2', name: 'Just b', ids: ['b'] },
    ]);

    owner.ws.close();
    late.ws.close();
});

test('rename and delete group ops take effect, and a spectator is refused', async () => {
    const groups = [{ id: 'g-1', name: 'Old', ids: ['a'] }];
    const { c: owner, welcome: hi } = await host([part('a'), part('b')], groups);
    const { c: other } = await guest(hi.code);

    other.send({ t: 'gop', op: { t: 'rename', id: 'g-1', name: 'Nope' } });
    assert.match((await other.next('error')).message, /spectator/);

    owner.send({ t: 'gop', op: { t: 'rename', id: 'g-1', name: 'New' } });
    await owner.next('gop');
    owner.send({ t: 'gop', op: { t: 'group', id: 'g-2', name: 'Gone soon', ids: ['b'] } });
    await owner.next('gop');
    owner.send({ t: 'gop', op: { t: 'delete', id: 'g-2' } });
    await owner.next('gop');

    const { c: late, welcome } = await guest(hi.code);
    assert.deepEqual(welcome.groups, [{ id: 'g-1', name: 'New', ids: ['a'] }]);

    owner.ws.close();
    other.ws.close();
    late.ws.close();
});

test('a malformed group op is refused', async () => {
    const { c: owner } = await host([part('a')]);

    owner.send({ t: 'gop', op: { t: 'nonsense' } });
    assert.match((await owner.next('error')).message, /unknown group op/);

    owner.send({ t: 'gop', op: { t: 'group', id: 'g-1', name: 'X', ids: ['a', 'a'] } });
    assert.match((await owner.next('error')).message, /duplicate part id/);

    owner.send({ t: 'gop', op: { t: 'group', id: 'g-1', name: 'X', ids: [] } });
    assert.match((await owner.next('error')).message, /needs ids/);

    owner.ws.close();
});


const token2 = (over = {}) => {
    const claim = JSON.stringify({
        v: 2, u: 1, n: 'Ada', m: 'testmap', t: null, r: 'editor', ...over,
    });
    const encoded = Buffer.from(claim, 'utf8').toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = crypto.createHmac('sha256', 'test-secret').update(`${encoded}.${exp}`).digest('hex');

    return `${encoded}.${exp}.${sig}`;
};

test('a stranger joining first does not become owner of an account map', async () => {
    const c = new Client();
    await c.open;
    c.send({
        t: 'create', mapName: 'testmap', parts: [part('a')], identity: token2({ u: 42 }),
    });
    const hi = await c.next('welcome');
    assert.equal(hi.you.owner, true);

    // The owner leaves; the room keeps its account, so an anonymous joiner cannot take it.
    c.ws.close();
    const { c: other, welcome } = await guest(hi.code);
    assert.equal(welcome.you.owner, false);
    assert.equal(welcome.you.role, 'spectator');

    other.ws.close();
});

test('an editor token grants developer, a viewer token does not', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'create', mapName: 'testmap', parts: [part('a')], identity: token2({ u: 1 }) });
    const hi = await c.next('welcome');

    const ed = new Client();
    await ed.open;
    ed.send({ t: 'join', code: hi.code, identity: token2({ u: 2, n: 'Bo' }) });
    assert.equal((await ed.next('welcome')).you.role, 'developer');

    const vw = new Client();
    await vw.open;
    vw.send({ t: 'join', code: hi.code, identity: token2({ u: 3, n: 'Cy', r: 'viewer' }) });
    assert.equal((await vw.next('welcome')).you.role, 'spectator');

    c.ws.close();
    ed.ws.close();
    vw.ws.close();
});

test('a token minted for another map grants nothing here', async () => {
    const c = new Client();
    await c.open;
    c.send({ t: 'create', mapName: 'testmap', parts: [part('a')], identity: token2({ u: 1 }) });
    const hi = await c.next('welcome');

    const other = new Client();
    await other.open;
    other.send({ t: 'join', code: hi.code, identity: token2({ u: 9, n: 'Dee', m: 'someone-else' }) });
    assert.equal((await other.next('welcome')).you.role, 'spectator');

    c.ws.close();
    other.ws.close();
});

// Rooms are keyed by map and team and outlive each test, so every test needs its own.
let teamSeq = 100;
const nextTeam = () => ++teamSeq;

const teamToken = (over = {}) => token2({ r: 'editor', ...over });

async function openTeam(team, over = {}, parts = [part('a')]) {
    const c = new Client();
    await c.open;
    c.send({
        t: 'open', mapName: 'testmap', parts, groups: [], identity: teamToken({ t: team, ...over }),
    });

    return c;
}

test('the first to open a team map starts the room and the next one lands in it', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1 });
    const first = await a.next('welcome');
    // An editor never runs the room just by arriving first.
    assert.equal(first.you.owner, false);
    assert.equal(first.you.role, 'developer');

    const b = await openTeam(team, { u: 2, n: 'Bo' }, [part('zzz')]);
    const second = await b.next('welcome');

    assert.equal(second.code, first.code);
    assert.equal(second.you.owner, false);
    assert.equal(second.you.role, 'developer');
    // The room's map wins, not whatever the joiner happened to be holding.
    assert.deepEqual(second.parts.map((p) => p._id), ['a']);

    a.ws.close();
    b.ws.close();
});

test('an edit by one team member reaches the other with no code passed around', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1 });
    await a.next('welcome');
    const b = await openTeam(team, { u: 2, n: 'Bo' });
    await b.next('welcome');

    b.send({ t: 'op', op: { t: 'add', items: [{ part: part('new') }] } });
    const seen = await a.next('op');
    assert.deepEqual(seen.op.items[0].part._id, 'new');

    a.ws.close();
    b.ws.close();
});

test('a viewer opening a team map lands as a spectator', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1 });
    await a.next('welcome');

    const v = await openTeam(team, { u: 3, n: 'Cy', r: 'viewer' });
    assert.equal((await v.next('welcome')).you.role, 'spectator');

    a.ws.close();
    v.ws.close();
});

test('a token for another team or another map cannot open the room', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1 });
    await a.next('welcome');

    const other = new Client();
    await other.open;
    other.send({
        t: 'open', mapName: 'testmap', parts: [part('a')], identity: teamToken({ t: team, u: 5, m: 'another-map' }),
    });
    assert.match((await other.next('error')).message, /cannot open a live session/);
    assert.equal(await other.closed, 4004);

    const noTeam = new Client();
    await noTeam.open;
    noTeam.send({
        t: 'open', mapName: 'testmap', parts: [part('a')], identity: token2({ u: 6, r: 'editor' }),
    });
    assert.match((await noTeam.next('error')).message, /cannot open a live session/);

    a.ws.close();
});

test('the team room outlives the member who opened it', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1 });
    const first = await a.next('welcome');
    const b = await openTeam(team, { u: 2, n: 'Bo' });
    await b.next('welcome');

    a.ws.close();

    const c = await openTeam(team, { u: 4, n: 'Di' });
    const back = await c.next('welcome');
    assert.equal(back.code, first.code);
    assert.equal(back.you.role, 'developer');
    assert.deepEqual(back.parts.map((p) => p._id), ['a']);

    b.ws.close();
    c.ws.close();
});

test('with no shared secret the client is taken at its word', async () => {
    const secret = process.env.LIVE_SECRET;
    const { config } = await import('../src/config.js');
    config.liveSecret = '';
    try {
        const c = new Client();
        await c.open;
        c.send({
            t: 'open', mapName: 'testmap', parts: [part('a')], groups: [], teamId: nextTeam(),
        });
        const hi = await c.next('welcome');
        assert.equal(hi.you.role, 'developer');
        c.ws.close();
    } finally {
        config.liveSecret = secret ?? 'test-secret';
    }
});

test('with no team id there is still nothing to open', async () => {
    const { config } = await import('../src/config.js');
    const secret = config.liveSecret;
    config.liveSecret = '';
    try {
        const c = new Client();
        await c.open;
        c.send({ t: 'open', mapName: 'testmap', parts: [part('a')], groups: [] });
        assert.match((await c.next('error')).message, /cannot open a live session/);
    } finally {
        config.liveSecret = secret;
    }
});

test('a team room cannot be reached by passing its code around', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1 });
    const hi = await a.next('welcome');
    assert.equal(hi.teamMap, true);

    const stranger = new Client();
    await stranger.open;
    stranger.send({ t: 'join', code: hi.code });
    assert.match((await stranger.next('error')).message, /belongs to a team/);
    assert.equal(await stranger.closed, 4004);

    const member = new Client();
    await member.open;
    member.send({ t: 'join', code: hi.code, identity: teamToken({ t: team, u: 9, n: 'Ev' }) });
    assert.equal((await member.next('welcome')).you.role, 'developer');

    a.ws.close();
    member.ws.close();
});


test('the team owner runs the room whenever they arrive', async () => {
    const team = nextTeam();
    const editor = await openTeam(team, { u: 1, n: 'Ed' });
    assert.equal((await editor.next('welcome')).you.owner, false);

    const boss = await openTeam(team, { u: 2, n: 'Boss', r: 'owner' });
    const hi = await boss.next('welcome');
    assert.equal(hi.you.owner, true);

    // And the editor is told the room now has one.
    const members = await editor.next('members', (m) => m.members.some((x) => x.owner));
    assert.equal(members.members.find((x) => x.owner).name, 'Boss');

    editor.ws.close();
    boss.ws.close();
});

test('an editor cannot kick or change roles in a team room', async () => {
    const team = nextTeam();
    const a = await openTeam(team, { u: 1, n: 'Ed' });
    const hi = await a.next('welcome');
    const b = await openTeam(team, { u: 2, n: 'Bo' });
    const you = await b.next('welcome');

    a.send({ t: 'kick', memberId: you.you.id });
    assert.match((await a.next('error')).message, /only the room owner/);

    a.send({ t: 'role', memberId: you.you.id, role: 'spectator' });
    assert.match((await a.next('error')).message, /only the room owner/);
    assert.equal(hi.you.owner, false);

    a.ws.close();
    b.ws.close();
});
