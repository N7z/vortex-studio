import { config } from './config.js';
import { uniqueName } from './identity.js';
import { MEMBER_COLORS, randomCode, randomId, randomName } from './names.js';
import { applyGroupOp, validateGroupOp } from './groupops.js';
import { applyOp, validateOp } from './ops.js';
import { cleanLights } from './lights.js';

const rooms = new Map();

export const ROLE_DEVELOPER = 'developer';
export const ROLE_SPECTATOR = 'spectator';

const now = () => Date.now();

class Member {
    constructor(socket, taken, identity = null) {
        this.id = randomId();
        this.token = randomId();
        this.socket = socket;
        this.userId = identity?.userId ?? null;
        this.owns = false;
        this.cap = null;
        this.name = (identity?.name && uniqueName(identity.name, taken)) || randomName(taken);
        this.role = ROLE_SPECTATOR;
        this.joinedAt = now();
        this.selection = [];
        this.view = null;
        this.play = null;
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

export function cleanPlay(input) {
    if (input === null || input === undefined) return null;
    if (!input || typeof input !== 'object') return undefined;
    const n = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6;
    if (!n(input.x) || !n(input.y) || !n(input.z) || !n(input.yaw)) return undefined;

    return {
        x: input.x,
        y: input.y,
        z: input.z,
        yaw: input.yaw,
        moving: !!input.moving,
        grounded: !!input.grounded,
        dead: !!input.dead,
    };
}

// `known` bounds membership to parts the room actually holds. Without it a client
// can pin unbounded id lists in memory, and Room.pruneGroups only cleans up after.
export function cleanGroups(input, known = null) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input) || input.length > config.maxGroups) return null;
    const out = [];
    const taken = new Set();
    let total = 0;
    for (const g of input) {
        if (!g || typeof g !== 'object') return null;
        if (typeof g.id !== 'string' || typeof g.name !== 'string') return null;
        if (!Array.isArray(g.ids)) return null;
        const ids = g.ids.filter((id) => typeof id === 'string' && id.length <= 64);
        if (ids.length !== g.ids.length) return null;
        for (const id of ids) {
            if (taken.has(id)) return null;
            taken.add(id);
        }
        total += ids.length;
        if (total > config.maxParts) return null;
        const live = known ? ids.filter((id) => known.has(id)) : ids;
        if (live.length) out.push({ id: g.id.slice(0, 64), name: g.name.slice(0, 64), ids: live });
    }

    return out;
}

class Room {
    constructor(code, mapName, parts, groups = [], ownerUserId = null, teamId = null, lights = []) {
        this.code = code;
        this.mapName = mapName;
        this.ownerUserId = ownerUserId;
        this.teamId = teamId;
        this.parts = parts;
        this.groups = groups;
        this.lights = lights;
        this.chat = [];
        this.pruneGroups();
        this.seq = 0;
        this.members = new Map();
        this.departed = new Map();
        this.banned = new Map();
        // A token lives in the browser, so a kick keyed only on it is undone by
        // clearing storage. These last as long as the room does.
        this.bannedUsers = new Set();
        this.roles = new Map();
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
                play: m.play,
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

    pruneBans() {
        for (const [token, at] of this.banned) {
            if (now() - at > config.banMs) this.banned.delete(token);
        }
        while (this.banned.size > config.maxBansPerRoom) {
            this.banned.delete(this.banned.keys().next().value);
        }
    }

    isBanned(token) {
        this.pruneBans();

        return !!token && this.banned.has(token);
    }

    ban(memberId) {
        const member = this.members.get(memberId);
        if (!member) return;

        this.banned.set(member.token, now());
        if (member.userId != null) this.bannedUsers.add(member.userId);
        this.departed.delete(member.token);
        this.pruneBans();
    }

    isUserBanned(identity) {
        return identity?.userId != null && this.bannedUsers.has(identity.userId);
    }

    /**
     * A role the owner set by hand outlives a reconnect, and never rises above what
     * the token allows: a team viewer promoted in-room would be editing a map the
     * team says they may only look at.
     */
    roleFor(identity) {
        const claimed = this.claimedRole(identity);
        const set = identity?.userId != null ? this.roles.get(identity.userId) : null;
        if (!set) return claimed;
        if (set === ROLE_DEVELOPER && claimed !== ROLE_DEVELOPER) return claimed;

        return set;
    }

    noteRole(member, role) {
        if (member.userId == null) return;
        this.roles.set(member.userId, role);
    }

    add(socket, token, identity = null) {
        this.pruneDeparted();
        const back = token && !this.isBanned(token) ? this.departed.get(token) : null;

        const member = new Member(socket, this.takenNames(), identity);
        member.owns = this.claimsOwnership(identity);
        member.cap = this.claimedRole(identity);
        if (back) {
            this.departed.delete(token);
            member.id = back.id;
            member.token = token;
            member.name = back.name;
            member.color = back.color;
            // Role comes from the fresh token, not from what it was: a demoted user
            // must not keep edit rights for the whole grace period.
            member.role = this.roleFor(identity) ?? back.role;
        } else {
            member.color = this.freeColor();
            const claimed = this.roleFor(identity);
            if (claimed) member.role = claimed;
        }

        this.members.set(member.id, member);
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }

        if (back?.wasOwner && !this.ownerId && this.mayOwn(member)) {
            this.clearOwnerTimer();
            this.claimOwner(member);
        } else if (!this.ownerId && !this.ownerTimer && this.mayOwn(member)) {
            this.claimOwner(member);
        }

        return { member, resumed: !!back };
    }

    /**
     * A token minted for one map must not grant edit rights in another room, so the
     * claim only counts when its map and team match this room's.
     */
    claimedRole(identity) {
        if (!identity?.role) return null;
        if (identity.mapName !== this.mapName) return null;
        if ((identity.teamId ?? null) !== (this.teamId ?? null)) return null;

        return identity.role === 'viewer' ? ROLE_SPECTATOR : ROLE_DEVELOPER;
    }

    /** Only the team's own owner runs a team room, however early anyone else arrived. */
    claimsOwnership(identity) {
        if (this.teamId == null) return false;
        if (identity?.role !== 'owner') return false;

        return identity.mapName === this.mapName && (identity.teamId ?? null) === this.teamId;
    }

    /**
     * A team room outlives whoever opened it, so any of its editors may take it on.
     * A personal room stays with its account, or a stranger could claim someone's map.
     */
    mayOwn(member) {
        if (this.teamId != null) return member.owns;
        if (this.ownerUserId == null) return true;

        return member.userId === this.ownerUserId;
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
        const next = [...this.members.values()]
            .sort((a, b) => a.joinedAt - b.joinedAt)
            .find((m) => this.mayOwn(m) && m.role === ROLE_DEVELOPER)
            ?? [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt).find((m) => this.mayOwn(m));
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
        if (member.socket.bufferedAmount > config.maxBufferedBytes) {
            member.socket.close(4008, 'too far behind');

            return;
        }
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

    setPlayFrom(member, play) {
        const clean = cleanPlay(play);
        if (clean === undefined) return;
        if (clean === null && member.play === null) return;

        member.play = clean;
        this.broadcast({ t: 'play', id: member.id, play: clean }, member.id);
    }

    applyGroupOpFrom(member, op) {
        if (!this.canEdit(member)) return 'you are a spectator in this room';
        const bad = validateGroupOp(op, config.maxGroups);
        if (bad) return bad;

        const next = applyGroupOp(this.groups, op);
        if (next.length > config.maxGroups) return 'too many folders';
        this.groups = next;
        this.pruneGroups();
        this.seq++;
        this.broadcast({ t: 'gop', op, seq: this.seq, from: member.id });

        return null;
    }

    /** Lights are a short list, so they are replaced whole rather than patched. */
    setLightsFrom(member, lights) {
        if (!this.canEdit(member)) return 'you are a spectator in this room';
        const clean = cleanLights(lights);
        if (!clean) return 'bad light data';

        this.lights = clean;
        this.broadcast({ t: 'lights', lights: this.lights, from: member.id }, member.id);

        return null;
    }

    setGroupsFrom(member, groups) {
        if (!this.canEdit(member)) return 'you are a spectator in this room';
        const clean = cleanGroups(groups, new Set(this.parts.map((p) => p._id)));
        if (!clean) return 'bad group data';

        this.groups = clean;
        this.pruneGroups();
        this.broadcast({ t: 'groups', groups: this.groups, from: member.id }, member.id);

        return null;
    }

    /** Anyone in the room may talk, spectators included: the room is the moderation. */
    chatFrom(member, text) {
        if (typeof text !== 'string') return;
        const body = text.replace(/\s+/g, ' ').trim().slice(0, config.maxChatLength);
        if (!body) return;

        const message = {
            id: randomId(),
            from: member.id,
            name: member.name,
            color: member.color,
            text: body,
            at: now(),
        };
        this.chat.push(message);
        if (this.chat.length > config.maxChatHistory) this.chat.shift();
        this.broadcast({ t: 'chat', message });
    }
}

export function createRoom(mapName, parts, groups = [], ownerUserId = null, teamId = null, lights = []) {
    if (rooms.size >= config.maxRooms) return null;
    let code;
    do {
        code = randomCode();
    } while (rooms.has(code));

    const room = new Room(code, mapName, parts, groups, ownerUserId, teamId, lights);
    rooms.set(code, room);

    return room;
}

export function getRoom(code) {
    return rooms.get(code) ?? null;
}

/**
 * The one room a team map may have. Everyone who opens that map lands in it, so
 * there is no code to pass around and no second room to split the team across.
 */
export function findTeamRoom(mapName, teamId) {
    if (teamId == null) return null;

    return [...rooms.values()].find((r) => r.teamId === teamId && r.mapName === mapName) ?? null;
}

export function roomStats() {
    return {
        rooms: rooms.size,
        members: [...rooms.values()].reduce((n, r) => n + r.members.size, 0),
    };
}
