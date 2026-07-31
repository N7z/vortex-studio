import { config } from './config.js';
import { uniqueName } from './identity.js';
import { MEMBER_COLORS, randomCode, randomId, randomName } from './names.js';
import { applyOp, validateOp } from './ops.js';

const rooms = new Map();

export const ROLE_DEVELOPER = 'developer';
export const ROLE_SPECTATOR = 'spectator';

const now = () => Date.now();

class Member {
    constructor(socket, taken, verifiedName = null) {
        this.id = randomId();
        this.token = randomId();
        this.socket = socket;
        this.name = (verifiedName && uniqueName(verifiedName, taken)) || randomName(taken);
        this.role = ROLE_SPECTATOR;
        this.joinedAt = now();
        this.selection = [];
        this.view = null;
        this.color = '#888888';
    }
}

const vec3 = (v) => Array.isArray(v)
    && v.length === 3
    && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export function cleanView(input) {
    if (!input || typeof input !== 'object') return null;
    if (!vec3(input.p) || !vec3(input.d)) return null;

    return { p: input.p, d: input.d };
}

export function cleanGroups(input) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input) || input.length > config.maxGroups) return null;
    const out = [];
    for (const g of input) {
        if (!g || typeof g !== 'object') return null;
        if (typeof g.id !== 'string' || typeof g.name !== 'string') return null;
        if (!Array.isArray(g.ids)) return null;
        const ids = g.ids.filter((id) => typeof id === 'string');
        if (ids.length !== g.ids.length) return null;
        out.push({ id: g.id.slice(0, 64), name: g.name.slice(0, 64), ids });
    }

    return out;
}

class Room {
    constructor(code, mapName, parts, groups = []) {
        this.code = code;
        this.mapName = mapName;
        this.parts = parts;
        this.groups = groups;
        this.seq = 0;
        this.members = new Map();
        this.departed = new Map();
        this.ownerId = null;
        this.createdAt = now();
        this.lastSavedAt = null;
        this.graceTimer = null;
        this.ownerTimer = null;
    }

    get memberList() {
        return [...this.members.values()]
            .sort((a, b) => a.joinedAt - b.joinedAt)
            .map((m) => ({
                id: m.id,
                name: m.name,
                role: m.role,
                color: m.color,
                owner: m.id === this.ownerId,
                selection: m.selection,
                view: m.view,
            }));
    }

    canEdit(member) {
        return member.id === this.ownerId || member.role === ROLE_DEVELOPER;
    }

    takenNames() {
        return new Set([...this.members.values()].map((m) => m.name));
    }

    freeColor() {
        const used = new Set([...this.members.values()].map((m) => m.color));

        return MEMBER_COLORS.find((c) => !used.has(c))
            ?? MEMBER_COLORS[this.members.size % MEMBER_COLORS.length];
    }

    pruneDeparted() {
        for (const [token, gone] of this.departed) {
            if (now() - gone.at > config.roomGraceMs) this.departed.delete(token);
        }
    }

    add(socket, token, verifiedName = null) {
        this.pruneDeparted();
        const back = token ? this.departed.get(token) : null;

        const member = new Member(socket, this.takenNames(), verifiedName);
        if (back) {
            this.departed.delete(token);
            member.id = back.id;
            member.token = token;
            member.name = back.name;
            member.color = back.color;
            member.role = back.role;
        } else {
            member.color = this.freeColor();
        }

        this.members.set(member.id, member);
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }

        if (back?.wasOwner && !this.ownerId) {
            this.clearOwnerTimer();
            this.claimOwner(member);
        } else if (!this.ownerId && !this.ownerTimer) {
            this.claimOwner(member);
        }

        return { member, resumed: !!back };
    }

    claimOwner(member) {
        this.ownerId = member.id;
        member.role = ROLE_DEVELOPER;
    }

    clearOwnerTimer() {
        if (!this.ownerTimer) return;
        clearTimeout(this.ownerTimer);
        this.ownerTimer = null;
    }

    promoteOldest() {
        this.ownerTimer = null;
        if (this.ownerId) return;
        const next = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (!next) return;

        this.claimOwner(next);
        this.send(next, { t: 'you', role: next.role, owner: true });
        this.broadcastMembers();
    }

    remove(memberId) {
        const member = this.members.get(memberId);
        if (!member) return;
        this.members.delete(memberId);

        this.departed.set(member.token, {
            id: member.id,
            name: member.name,
            color: member.color,
            role: member.role,
            wasOwner: this.ownerId === memberId,
            at: now(),
        });
        this.pruneDeparted();

        if (this.ownerId === memberId) {
            this.ownerId = null;
            if (this.members.size) {
                this.ownerTimer = setTimeout(() => this.promoteOldest(), config.ownerGraceMs);
                this.ownerTimer.unref?.();
            }
        }

        if (!this.members.size) {
            this.clearOwnerTimer();
            this.graceTimer = setTimeout(() => rooms.delete(this.code), config.roomGraceMs);
            this.graceTimer.unref?.();
        }
    }

    send(member, msg) {
        if (member.socket.readyState !== 1) return;
        try {
            member.socket.send(JSON.stringify(msg));
        } catch { /* socket is closing; the close handler tidies up */ }
    }

    broadcast(msg, exceptId = null) {
        for (const m of this.members.values()) {
            if (m.id !== exceptId) this.send(m, msg);
        }
    }

    broadcastMembers() {
        this.broadcast({ t: 'members', members: this.memberList, ownerId: this.ownerId });
    }

    applyFrom(member, op) {
        if (!this.canEdit(member)) return 'you are a spectator in this room';
        if (op?.t === 'replace' && member.id !== this.ownerId) {
            return 'only the room owner can replace the map';
        }

        const bad = validateOp(op, config.maxParts);
        if (bad) return bad;

        const next = applyOp(this.parts, op);
        if (next.length > config.maxParts) return 'map too large';
        this.parts = next;
        if (op.t === 'remove' || op.t === 'replace') this.pruneGroups();
        this.seq++;
        this.broadcast({ t: 'op', op, seq: this.seq, from: member.id });

        return null;
    }

    pruneGroups() {
        if (!this.groups.length) return;
        const alive = new Set(this.parts.map((p) => p._id));
        this.groups = this.groups
            .map((g) => ({ ...g, ids: g.ids.filter((id) => alive.has(id)) }))
            .filter((g) => g.ids.length);
    }

    setViewFrom(member, view) {
        const clean = cleanView(view);
        if (!clean) return;

        member.view = clean;
        this.broadcast({ t: 'view', id: member.id, view: clean }, member.id);
    }

    setGroupsFrom(member, groups) {
        if (!this.canEdit(member)) return 'you are a spectator in this room';
        const clean = cleanGroups(groups);
        if (!clean) return 'bad group data';

        this.groups = clean;
        this.pruneGroups();
        this.broadcast({ t: 'groups', groups: this.groups, from: member.id }, member.id);

        return null;
    }
}

export function createRoom(mapName, parts, groups = []) {
    if (rooms.size >= config.maxRooms) return null;
    let code;
    do {
        code = randomCode();
    } while (rooms.has(code));

    const room = new Room(code, mapName, parts, groups);
    rooms.set(code, room);

    return room;
}

export function getRoom(code) {
    return rooms.get(code) ?? null;
}

export function roomStats() {
    return {
        rooms: rooms.size,
        members: [...rooms.values()].reduce((n, r) => n + r.members.size, 0),
    };
}
