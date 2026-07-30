import http from 'node:http';
import { WebSocketServer } from 'ws';

import { config, originAllowed } from './config.js';
import { normaliseCode } from './names.js';
import { validPart } from './ops.js';
import {
    ROLE_DEVELOPER, ROLE_SPECTATOR, cleanGroups, createRoom, getRoom, roomStats,
} from './rooms.js';

const HELLO_TIMEOUT_MS = 15_000;
const MAX_SELECTION_BROADCAST = 200;

function send(ws, msg) {
    if (ws.readyState !== 1) return;
    try {
        ws.send(JSON.stringify(msg));
    } catch { /* socket is closing */ }
}

const fail = (ws, message) => send(ws, { t: 'error', message });

function refuse(ws, message) {
    send(ws, { t: 'error', message });
    ws.close(4004, 'refused');
}

function cleanParts(input) {
    if (!Array.isArray(input) || input.length > config.maxParts) return null;
    if (!input.every(validPart)) return null;
    if (new Set(input.map((p) => p._id)).size !== input.length) return null;

    return input;
}

export function createLiveServer({ log = () => {} } = {}) {
    const sockets = new Map();

    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ...roomStats() }));

            return;
        }
        res.writeHead(404).end('vortex studio live server');
    });

    const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

    server.on('upgrade', (req, socket, head) => {
        if (!originAllowed(req.headers.origin)) {
            log('rejected upgrade from origin', req.headers.origin);
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();

            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    function welcome(ws, room, member, resumed) {
        sockets.set(ws, { room, member });
        send(ws, {
            t: 'welcome',
            code: room.code,
            mapName: room.mapName,
            seq: room.seq,
            parts: room.parts,
            groups: room.groups,
            lastSavedAt: room.lastSavedAt,
            resumed,
            you: {
                id: member.id,
                name: member.name,
                token: member.token,
                role: member.role,
                color: member.color,
                owner: member.id === room.ownerId,
            },
            members: room.memberList,
        });
        room.broadcastMembers();
    }

    function handleCreate(ws, msg) {
        const mapName = typeof msg.mapName === 'string' ? msg.mapName.slice(0, 64) : '';
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(mapName)) return refuse(ws, 'bad map name');

        const parts = cleanParts(msg.parts);
        if (!parts) return refuse(ws, 'bad map data');

        const groups = cleanGroups(msg.groups);
        if (!groups) return refuse(ws, 'bad group data');

        const room = createRoom(mapName, parts, groups);
        if (!room) return refuse(ws, 'the server is at its room limit, try again later');

        const { member } = room.add(ws);
        log(`room ${room.code} created for ${mapName} by ${member.name}`);
        welcome(ws, room, member, false);
    }

    function handleJoin(ws, msg) {
        const room = getRoom(normaliseCode(msg.code));
        if (!room) return refuse(ws, 'no live session with that code');
        if (room.members.size >= config.maxMembersPerRoom) return refuse(ws, 'that session is full');

        const token = typeof msg.token === 'string' ? msg.token : null;
        const { member, resumed } = room.add(ws, token);
        log(`room ${room.code}: ${member.name} ${resumed ? 'reconnected' : 'joined'} (${room.members.size} present)`);
        welcome(ws, room, member, resumed);
    }

    function handleRole(ctx, msg) {
        const { room, member } = ctx;
        if (member.id !== room.ownerId) {
            return fail(member.socket, 'only the room owner can change roles');
        }

        const target = room.members.get(msg.memberId);
        if (!target) return;
        if (target.id === room.ownerId) return fail(member.socket, 'the owner is always a developer');
        if (msg.role !== ROLE_DEVELOPER && msg.role !== ROLE_SPECTATOR) {
            return fail(member.socket, 'unknown role');
        }
        if (target.role === msg.role) return;

        target.role = msg.role;
        if (msg.role === ROLE_SPECTATOR) target.selection = [];
        log(`room ${room.code}: ${target.name} is now ${target.role}`);
        room.send(target, { t: 'you', role: target.role, owner: false });
        room.broadcastMembers();
    }

    function handleKick(ctx, msg) {
        const { room, member } = ctx;
        if (member.id !== room.ownerId) {
            return fail(member.socket, 'only the room owner can remove people');
        }

        const target = room.members.get(msg.memberId);
        if (!target || target.id === room.ownerId) return;

        log(`room ${room.code}: ${target.name} kicked`);
        room.send(target, { t: 'kicked', reason: 'The room owner removed you from this session.' });
        target.socket.close(4003, 'kicked');
    }

    function handleSelection(ctx, msg) {
        const { room, member } = ctx;
        if (!room.canEdit(member)) return;
        if (!Array.isArray(msg.ids)) return;

        member.selection = msg.ids
            .filter((id) => typeof id === 'string')
            .slice(0, MAX_SELECTION_BROADCAST);
        room.broadcast({ t: 'selection', id: member.id, selection: member.selection }, member.id);
    }

    function handleMessage(ws, raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return fail(ws, 'malformed message');
        }
        if (!msg || typeof msg !== 'object') return fail(ws, 'malformed message');

        const ctx = sockets.get(ws);
        if (!ctx) {
            if (msg.t === 'create') return handleCreate(ws, msg);
            if (msg.t === 'join') return handleJoin(ws, msg);

            return fail(ws, 'join a session first');
        }

        const { room, member } = ctx;
        switch (msg.t) {
            case 'op': {
                const bad = room.applyFrom(member, msg.op);
                if (bad) {
                    fail(ws, bad);
                    send(ws, {
                        t: 'snapshot', parts: room.parts, groups: room.groups, seq: room.seq,
                    });
                }

                return;
            }
            case 'groups': {
                const bad = room.setGroupsFrom(member, msg.groups);
                if (bad) fail(ws, bad);

                return;
            }
            case 'view':
                return room.setViewFrom(member, msg.view);
            case 'selection':
                return handleSelection(ctx, msg);
            case 'role':
                return handleRole(ctx, msg);
            case 'kick':
                return handleKick(ctx, msg);
            case 'saved': {
                if (member.id !== room.ownerId) return;
                room.lastSavedAt = Date.now();

                return room.broadcast({ t: 'saved', at: room.lastSavedAt });
            }
            case 'resync':
                return send(ws, {
                    t: 'snapshot', parts: room.parts, groups: room.groups, seq: room.seq,
                });
            case 'ping':
                return send(ws, { t: 'pong' });
            default:
                return fail(ws, `unknown message ${String(msg.t)}`);
        }
    }

    wss.on('connection', (ws) => {
        ws.alive = true;
        ws.on('pong', () => { ws.alive = true; });

        const helloTimer = setTimeout(() => {
            if (!sockets.has(ws)) ws.close(4000, 'no session');
        }, HELLO_TIMEOUT_MS);
        helloTimer.unref?.();

        ws.on('message', (raw) => {
            try {
                handleMessage(ws, raw.toString());
            } catch (e) {
                log('handler error:', e);
                fail(ws, 'server error handling that message');
            }
        });

        ws.on('close', () => {
            clearTimeout(helloTimer);
            const ctx = sockets.get(ws);
            sockets.delete(ws);
            if (!ctx) return;

            const { room, member } = ctx;
            room.remove(member.id);
            log(`room ${room.code}: ${member.name} left (${room.members.size} present)`);
            room.broadcastMembers();
        });

        ws.on('error', () => ws.close());
    });

    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.alive) {
                ws.terminate();
                continue;
            }
            ws.alive = false;
            ws.ping();
        }
    }, config.heartbeatMs);
    heartbeat.unref?.();

    return {
        server,
        wss,
        listen: (port = config.port) => new Promise((resolve) => {
            server.listen(port, () => resolve(server.address().port));
        }),
        close: () => new Promise((resolve) => {
            clearInterval(heartbeat);
            for (const ws of wss.clients) ws.terminate();
            server.close(() => resolve());
        }),
    };
}
