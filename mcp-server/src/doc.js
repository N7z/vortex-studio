import {
    applyOp, invertOp, validateOp, validPart,
} from '../../live-editing-server/src/ops.js';
import {
    applyGroupOp, pruneEmptyGroups, validateGroupOp,
} from '../../live-editing-server/src/groupops.js';
import { DEFAULT_LIGHTING, cleanLighting } from '../../live-editing-server/src/lights.js';
import { LIMITS } from './catalog.js';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LEN = 10;
const HISTORY_LIMIT = 100;

export function newId() {
    const bytes = new Uint8Array(ID_LEN);
    globalThis.crypto.getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += ID_CHARS[b % ID_CHARS.length];

    return out;
}

export const newGroupId = () => `g-${newId()}`;

export class MapError extends Error {}

export class MapDoc {
    constructor({
        parts = [], groups = [], lighting = null, sink = null, maxParts = LIMITS.maxParts,
    } = {}) {
        this.parts = parts;
        this.groups = groups;
        this.lighting = cleanLighting(lighting) ?? { ...DEFAULT_LIGHTING };
        this.sink = sink;
        this.maxParts = maxParts;
        this.past = [];
        this.future = [];
    }

    attach(sink) {
        this.sink = sink;
    }

    reset({ parts = [], groups = [], lighting = null }) {
        this.parts = parts;
        this.groups = groups;
        this.lighting = cleanLighting(lighting) ?? { ...DEFAULT_LIGHTING };
        this.past = [];
        this.future = [];
    }

    applyRemote(op) {
        this.parts = applyOp(this.parts, op);
        this.groups = pruneGroups(this.groups, this.parts);
    }

    applyRemoteGroupOp(op) {
        this.groups = pruneGroups(applyGroupOp(this.groups, op), this.parts);
    }

    setRemoteGroups(groups) {
        this.groups = pruneGroups(groups ?? [], this.parts);
    }

    setRemoteLighting(lighting) {
        this.lighting = cleanLighting(lighting) ?? this.lighting;
    }

    byId(id) {
        return this.parts.find((p) => p._id === id) ?? null;
    }

    require(id) {
        const part = this.byId(id);
        if (!part) throw new MapError(`no part with id "${id}"`);

        return part;
    }

    groupById(id) {
        return this.groups.find((g) => g.id === id) ?? null;
    }

    /**
     * Applies a list of changes as ONE undoable, atomic action. Everything is
     * validated against the state it will really land on before anything is
     * committed, so a bad step in a big build leaves the map untouched.
     */
    commit(label, changes) {
        const list = changes.filter(Boolean);
        if (!list.length) return { label, parts: 0, undo: this.past.length };

        const start = {
            parts: this.parts,
            groups: this.groups,
            lighting: this.lighting,
        };
        let state = start;
        const inverses = [];

        for (const change of list) {
            if (change.op) {
                const bad = validateOp(change.op, this.maxParts);
                if (bad) throw new MapError(bad);
                const next = applyOp(state.parts, change.op);
                if (next.length > this.maxParts) {
                    throw new MapError(
                        `this would take the map to ${next.length} parts, over the ${this.maxParts} limit`,
                    );
                }
                inverses.push({ op: invertOp(state.parts, change.op) });
                state = { ...state, parts: next };
                continue;
            }
            if (change.gop) {
                const bad = validateGroupOp(change.gop, LIMITS.maxGroups);
                if (bad) throw new MapError(bad);
                inverses.push({ groups: state.groups });
                state = { ...state, groups: applyGroupOp(state.groups, change.gop) };
                continue;
            }
            if (change.lighting) {
                const clean = cleanLighting(change.lighting);
                if (!clean) throw new MapError('bad light data');
                inverses.push({ lighting: state.lighting });
                state = { ...state, lighting: clean };
            }
        }

        this.parts = state.parts;
        this.groups = pruneGroups(state.groups, state.parts);
        this.lighting = state.lighting;

        this.past.push({ label, inverses: inverses.filter((i) => i.op || i.groups || i.lighting) });
        if (this.past.length > HISTORY_LIMIT) this.past.shift();
        this.future = [];

        this.publish(list);

        return { label, parts: this.parts.length, undo: this.past.length };
    }

    publish(changes) {
        if (!this.sink) return;
        for (const change of changes) {
            if (change.op) this.sink.sendOp(change.op);
            else if (change.gop) this.sink.sendGroupOp(change.gop);
            else if (change.lighting) this.sink.sendLighting(this.lighting);
        }
        if (changes.some((c) => c.gop)) this.sink.sendGroups(this.groups);
    }

    findGroup(ref) {
        if (!ref) return null;

        return this.groups.find((g) => g.id === ref) ?? this.groups.find((g) => g.name === ref) ?? null;
    }

    addParts(label, parts, { groupName = null, appendToExisting = false } = {}) {
        const withIds = parts.map((p) => {
            const part = { _id: newId(), ...p };
            if (!validPart(part)) {
                throw new MapError(`built an invalid part: ${JSON.stringify(part).slice(0, 200)}`);
            }

            return part;
        });

        const changes = [{ op: { t: 'add', items: withIds.map((part) => ({ part })) } }];
        let groupId = null;
        let name = groupName ?? null;
        let appended = false;
        if (groupName && withIds.length) {
            const existing = appendToExisting ? this.findGroup(groupName) : null;
            groupId = existing?.id ?? newGroupId();
            name = existing?.name ?? groupName;
            appended = !!existing;
            changes.push({
                gop: {
                    t: 'group',
                    id: groupId,
                    name,
                    ids: [...(existing?.ids ?? []), ...withIds.map((p) => p._id)],
                },
            });
        }

        const result = this.commit(label, changes);

        return {
            ...result,
            added: withIds.length,
            ids: withIds.map((p) => p._id),
            groupId,
            groupName: name,
            appendedToFolder: appended,
        };
    }

    groupParts(label, {
        folder, ids, replace = false, parent,
    }) {
        const alive = new Set(this.parts.map((p) => p._id));
        const hit = [...new Set(ids)].filter((id) => alive.has(id));
        if (!hit.length) throw new MapError('none of those ids are in the map');

        const existing = this.findGroup(folder);
        const id = existing?.id ?? newGroupId();
        const name = existing?.name ?? folder;
        const kept = replace || !existing ? [] : existing.ids.filter((x) => alive.has(x));
        const merged = [...new Set([...kept, ...hit])];

        let under = existing?.parent ?? null;
        if (parent !== undefined) {
            if (parent === null) under = null;
            else {
                const owner = this.findGroup(parent);
                if (!owner) throw new MapError(`no folder called "${parent}" to nest it in`);
                if (owner.id === id) throw new MapError('a folder cannot hold itself');
                under = owner.id;
            }
        }

        const result = this.commit(label, [{
            gop: {
                t: 'group', id, name, ids: merged, ...(under ? { parent: under } : {}),
            },
        }]);

        return {
            ...result,
            folderId: id,
            folder: name,
            moved: hit.length,
            parts: merged.length,
            ...(under ? { parent: this.findGroup(under)?.name ?? under } : {}),
        };
    }

    renameGroup(label, folder, name) {
        const existing = this.findGroup(folder);
        if (!existing) throw new MapError(`no folder called "${folder}"`);
        const was = existing.name;
        const result = this.commit(label, [{ gop: { t: 'rename', id: existing.id, name } }]);

        return {
            ...result, folderId: existing.id, was, folder: name,
        };
    }

    deleteGroup(label, folder) {
        const existing = this.findGroup(folder);
        if (!existing) throw new MapError(`no folder called "${folder}"`);
        const result = this.commit(label, [{ gop: { t: 'delete', id: existing.id } }]);

        return {
            ...result, removedFolder: existing.name, folderId: existing.id, looseParts: existing.ids.length,
        };
    }

    replaceParts(label, removedIds, newParts) {
        const items = newParts.map((part) => {
            const built = { _id: newId(), ...part };
            if (!validPart(built)) {
                throw new MapError(`built an invalid part: ${JSON.stringify(built).slice(0, 200)}`);
            }

            return { part: built };
        });

        const result = this.commit(label, [
            removedIds.length ? { op: { t: 'remove', ids: removedIds } } : null,
            items.length ? { op: { t: 'add', items } } : null,
        ]);

        return { ...result, removed: removedIds.length, added: items.length };
    }

    removeParts(label, ids) {
        const alive = new Set(this.parts.map((p) => p._id));
        const hit = [...new Set(ids)].filter((id) => alive.has(id));
        if (!hit.length) throw new MapError('none of those ids are in the map');

        return { ...this.commit(label, [{ op: { t: 'remove', ids: hit } }]), removed: hit.length };
    }

    setFields(label, updates) {
        const alive = new Set(this.parts.map((p) => p._id));
        const items = updates
            .filter((u) => alive.has(u.id))
            .map(({ id, fields, unset }) => ({ id, fields, unset }));
        if (!items.length) throw new MapError('none of those ids are in the map');

        return { ...this.commit(label, [{ op: { t: 'set', items } }]), changed: items.length };
    }

    setLighting(label, lighting) {
        return this.commit(label, [{ lighting }]);
    }

    step(from, to) {
        const entry = from.pop();
        if (!entry) return null;

        const redo = [];
        for (const inverse of [...entry.inverses].reverse()) {
            if (inverse.op) {
                redo.push({ op: invertOp(this.parts, inverse.op) });
                this.parts = applyOp(this.parts, inverse.op);
                this.publish([{ op: inverse.op }]);
            } else if (inverse.groups) {
                redo.push({ groups: this.groups });
                this.groups = inverse.groups;
                this.sink?.sendGroups(this.groups);
            } else if (inverse.lighting) {
                redo.push({ lighting: this.lighting });
                this.lighting = inverse.lighting;
                this.sink?.sendLighting(this.lighting);
            }
        }
        this.groups = pruneGroups(this.groups, this.parts);
        to.push({ label: entry.label, inverses: redo.reverse() });

        return entry.label;
    }

    undo() {
        const label = this.step(this.past, this.future);
        if (!label) throw new MapError('there is nothing to undo');

        return { undone: label, parts: this.parts.length, undo: this.past.length };
    }

    redo() {
        const label = this.step(this.future, this.past);
        if (!label) throw new MapError('there is nothing to redo');

        return { redone: label, parts: this.parts.length, redo: this.future.length };
    }

    get historyLabels() {
        return this.past.map((e) => e.label);
    }
}

export function pruneGroups(groups, parts) {
    if (!groups.length) return groups;
    const alive = new Set(parts.map((p) => p._id));
    let changed = false;
    const out = [];
    for (const g of groups) {
        const ids = g.ids.filter((id) => alive.has(id));
        if (ids.length === g.ids.length) {
            out.push(g);
            continue;
        }
        changed = true;
        out.push({ ...g, ids });
    }

    // A folder that lost its last part still stands while it holds another folder.
    return changed ? pruneEmptyGroups(out) : groups;
}
