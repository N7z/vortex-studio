import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { WebSocket } from 'ws';

process.env.OWNER_GRACE_SECONDS = '1';
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

async function host(parts = [part('a')]) {
    const c = new Client();
    await c.open;
    c.send({ t: 'create', mapName: 'testmap', parts });
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
