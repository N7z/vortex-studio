import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { WebSocket } from 'ws';

import { cleanPlay } from '../src/rooms.js';

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

const STATE = { x: 1, y: 2, z: 3, yaw: 0.5, moving: true, grounded: true, dead: false };

class Client {
    constructor() {
        this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
        this.inbox = [];
        this.waiters = [];
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

    seen(type) {
        return this.inbox.some((m) => m.t === type);
    }
}

const part = { _id: 'a', T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0] };

async function room() {
    const host = new Client();
    await host.open;
    host.send({ t: 'create', mapName: 'testmap', parts: [part] });
    const welcome = await host.next('welcome');

    const guest = new Client();
    await guest.open;
    guest.send({ t: 'join', code: welcome.code });
    await guest.next('welcome');
    await host.next('members', (m) => m.members.length === 2);

    return { host, guest, code: welcome.code };
}

test('a play state reaches the other member', async () => {
    const { host, guest } = await room();

    host.send({ t: 'play', play: STATE });
    const got = await guest.next('play');
    assert.deepEqual(got.play, STATE);
});

test('stopping broadcasts a null state', async () => {
    const { host, guest } = await room();

    host.send({ t: 'play', play: STATE });
    await guest.next('play');
    host.send({ t: 'play', play: null });
    const got = await guest.next('play');
    assert.equal(got.play, null);
});

test('a player is not told about their own play state', async () => {
    const { host, guest } = await room();

    host.send({ t: 'play', play: STATE });
    await guest.next('play');
    assert.equal(host.seen('play'), false);
});

test('someone joining mid-test sees who is already playing', async () => {
    const { host, code } = await room();
    host.send({ t: 'play', play: STATE });

    const late = new Client();
    await late.open;
    late.send({ t: 'join', code });
    const welcome = await late.next('welcome');

    const playing = welcome.members.filter((m) => m.play);
    assert.equal(playing.length, 1);
    assert.deepEqual(playing[0].play, STATE);
});

test('a spectator may play, since playing is not editing', async () => {
    const { host, guest } = await room();

    guest.send({ t: 'play', play: STATE });
    const got = await host.next('play');
    assert.deepEqual(got.play, STATE);
});

test('garbage is dropped rather than broadcast', async () => {
    const { host, guest } = await room();

    for (const bad of [{ x: 'a', y: 0, z: 0, yaw: 0 }, { x: 0, y: 0 }, { x: NaN, y: 0, z: 0, yaw: 0 }, 7, 'x']) {
        host.send({ t: 'play', play: bad });
    }
    host.send({ t: 'play', play: STATE });

    const got = await guest.next('play');
    assert.deepEqual(got.play, STATE);
});

test('cleanPlay accepts, rejects and normalises', () => {
    assert.deepEqual(cleanPlay(STATE), STATE);
    assert.equal(cleanPlay(null), null);
    assert.equal(cleanPlay(undefined), null);
    assert.equal(cleanPlay({ x: 0, y: 0, z: 0 }), undefined);
    assert.equal(cleanPlay({ x: 0, y: 0, z: 0, yaw: Infinity }), undefined);
    assert.equal(cleanPlay({ x: 1e9, y: 0, z: 0, yaw: 0 }), undefined);
    assert.deepEqual(
        cleanPlay({ x: 0, y: 0, z: 0, yaw: 0, moving: 'yes', grounded: 1, dead: 0 }),
        { x: 0, y: 0, z: 0, yaw: 0, moving: true, grounded: true, dead: false },
    );
});
