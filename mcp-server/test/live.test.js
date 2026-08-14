import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { WebSocket } from 'ws';

process.env.LIVE_SECRET ??= 'mcp-test-secret';
process.env.ALLOWED_ORIGINS ??= '*';

const { createLiveServer } = await import('../../live-editing-server/src/server.js');
const { applyOp } = await import('../../live-editing-server/src/ops.js');
const { MapDoc } = await import('../src/doc.js');
const { LiveSession, joinHello, createHello } = await import('../src/session.js');
const { buildRoom } = await import('../src/build.js');

function mintIdentity({
    userId, name, mapName, teamId = null, role = 'editor',
}) {
    const payload = {
        v: 2, u: userId, n: name, m: mapName, t: teamId, r: role,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = crypto.createHmac('sha256', process.env.LIVE_SECRET)
        .update(`${encoded}.${exp}`).digest('hex');

    return `${encoded}.${exp}.${sig}`;
}

class Browser {
    constructor(url) {
        this.url = url;
        this.parts = [];
        this.members = [];
        this.ops = 0;
        this.welcomed = null;
    }

    open(hello) {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url, { origin: 'http://localhost' });
            this.ws.on('open', () => this.ws.send(JSON.stringify(hello)));
            this.ws.on('error', reject);
            this.ws.on('message', (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.t === 'welcome') {
                    this.parts = msg.parts;
                    this.members = msg.members;
                    this.welcomed = msg;
                    resolve(msg);
                }
                if (msg.t === 'op') {
                    this.parts = applyOp(this.parts, msg.op);
                    this.ops += 1;
                }
                if (msg.t === 'members') this.members = msg.members;
                if (msg.t === 'error') reject(new Error(msg.message));
            });
        });
    }

    settled(check, label) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const tick = () => {
                if (check()) return resolve();
                if (Date.now() - started > 3000) return reject(new Error(`timed out waiting for ${label}`));

                return setTimeout(tick, 10);
            };
            tick();
        });
    }

    close() {
        this.ws?.close();
    }
}

async function withRoom(run) {
    const live = createLiveServer({});
    const port = await live.listen(0);
    const url = `ws://127.0.0.1:${port}`;

    const browser = new Browser(url);
    const welcome = await browser.open(createHello(
        'dungeon',
        [{
            _id: 'base', T: 'Part', P: [0, -2, 0], S: [200, 4, 200], R: [0, 0, 0], C: '4a4844',
        }],
        [],
        [],
        mintIdentity({ userId: 7, name: 'Paulo', mapName: 'dungeon', role: 'owner' }),
    ));

    const session = new LiveSession({ url, origin: 'http://localhost' });
    const doc = new MapDoc({});
    session.bind(doc);
    const joined = await session.open(joinHello(
        welcome.code,
        mintIdentity({ userId: 7, name: 'Paulo (MCP)', mapName: 'dungeon' }),
    ));

    try {
        await run({
            browser, session, doc, joined, welcome,
        });
    } finally {
        session.leave();
        browser.close();
        await live.close();
    }
}

test('the agent joins as the signed in user with an MCP suffix and can edit', async () => {
    await withRoom(async ({ browser, session, joined }) => {
        assert.equal(joined.you.name, 'Paulo (MCP)');
        assert.equal(joined.you.role, 'developer');
        assert.equal(session.canEdit, true);

        await browser.settled(() => browser.members.length === 2, 'the member list');
        const names = browser.members.map((m) => m.name).sort();
        assert.deepEqual(names, ['Paulo', 'Paulo (MCP)']);
    });
});

test('a room built through the agent reaches the browser in real time', async () => {
    await withRoom(async ({ browser, doc }) => {
        const parts = buildRoom({
            x: 0, z: 0, width: 60, depth: 40, height: 16, palette: 'dungeon',
        });
        const result = doc.addParts('Entrance Hall', parts, { groupName: 'Entrance Hall' });

        await browser.settled(
            () => browser.parts.length === result.added + 1,
            `${result.added} parts to arrive`,
        );

        const arrived = new Set(browser.parts.map((p) => p._id));
        for (const id of result.ids) assert.ok(arrived.has(id), `part ${id} never arrived`);
        assert.deepEqual(
            browser.parts.map((p) => p._id).sort(),
            doc.parts.map((p) => p._id).sort(),
        );
    });
});

test('undo through the agent removes the parts from the browser too', async () => {
    await withRoom(async ({ browser, doc }) => {
        const result = doc.addParts('room', buildRoom({
            x: 0, z: 0, width: 40, depth: 30, height: 14,
        }));
        await browser.settled(() => browser.parts.length === result.added + 1, 'the build');

        doc.undo();
        await browser.settled(() => browser.parts.length === 1, 'the undo');

        assert.deepEqual(browser.parts.map((p) => p._id), ['base']);
        assert.equal(doc.parts.length, 1);
    });
});

test('an edit made in the browser shows up in the agent working copy', async () => {
    await withRoom(async ({ browser, doc }) => {
        browser.ws.send(JSON.stringify({
            t: 'op',
            op: {
                t: 'add',
                items: [{
                    part: {
                        _id: 'byhand', T: 'Part', P: [10, 5, 10], S: [4, 4, 4], R: [0, 0, 0], C: 'ff0000',
                    },
                }],
            },
        }));

        await browser.settled(() => doc.parts.some((p) => p._id === 'byhand'), 'the remote part');
        assert.equal(doc.historyLabels.length, 0, 'a remote edit must not enter the agent undo stack');
    });
});

test('the agent and the browser converge after edits from both sides', async () => {
    await withRoom(async ({ browser, doc }) => {
        doc.addParts('agent side', [{
            T: 'Part', P: [0, 10, 0], S: [4, 4, 4], R: [0, 0, 0], C: '00ff00',
        }]);

        browser.ws.send(JSON.stringify({
            t: 'op',
            op: {
                t: 'add',
                items: [{
                    part: {
                        _id: 'human', T: 'Part', P: [20, 10, 0], S: [4, 4, 4], R: [0, 0, 0], C: '0000ff',
                    },
                }],
            },
        }));

        await browser.settled(() => browser.parts.length === 3 && doc.parts.length === 3, 'both edits');
        assert.deepEqual(
            browser.parts.map((p) => p._id).sort(),
            doc.parts.map((p) => p._id).sort(),
        );
    });
});

test('the server refuses edits from a spectator connection', async () => {
    const live = createLiveServer({});
    const port = await live.listen(0);
    const url = `ws://127.0.0.1:${port}`;

    const browser = new Browser(url);
    const welcome = await browser.open(createHello(
        'dungeon',
        [{
            _id: 'base', T: 'Part', P: [0, -2, 0], S: [200, 4, 200], R: [0, 0, 0], C: '4a4844',
        }],
        [],
        [],
        mintIdentity({ userId: 7, name: 'Paulo', mapName: 'dungeon', role: 'owner' }),
    ));

    const session = new LiveSession({ url, origin: 'http://localhost' });
    session.bind(new MapDoc({}));
    const joined = await session.open(joinHello(welcome.code, null));

    assert.equal(joined.you.role, 'spectator');
    assert.equal(session.canEdit, false);

    session.leave();
    browser.close();
    await live.close();
});
