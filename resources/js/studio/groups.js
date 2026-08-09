import { newPartId } from './ops.js';

export { applyGroupOp } from '../../../live-editing-server/src/groupops.js';

export const newGroupId = () => `g-${newPartId()}`;

export const newGroup = (name, ids) => ({
    id: newGroupId(),
    name,
    ids: [...ids],
});

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
        if (ids.length) out.push({ ...g, ids });
    }
    return changed ? out : groups;
}

export function groupIndex(groups) {
    const byPart = new Map();
    for (const g of groups) for (const id of g.ids) byPart.set(id, g);
    return byPart;
}

export function addGroup(groups, name, ids) {
    const taken = new Set(ids);
    const kept = groups
        .map((g) => ({ ...g, ids: g.ids.filter((id) => !taken.has(id)) }))
        .filter((g) => g.ids.length);
    return [...kept, newGroup(name, ids)];
}

export function removeGroups(groups, groupIds) {
    const drop = new Set(groupIds);
    return groups.filter((g) => !drop.has(g.id));
}

export function ungroupIds(groups, ids) {
    const touched = new Set(ids);
    return groups.filter((g) => !g.ids.some((id) => touched.has(id)));
}

const KEY = 'studio_groups';

export function takeLegacyGroups(mapName, parts) {
    if (!mapName) return [];
    let all;
    try {
        all = JSON.parse(localStorage.getItem(KEY));
    } catch {
        return [];
    }
    if (!all || typeof all !== 'object') return [];
    const stored = all[mapName];
    delete all[mapName];
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* ignore */ }

    if (!Array.isArray(stored)) return [];
    const out = [];
    for (const g of stored) {
        const ids = (Array.isArray(g?.idx) ? g.idx : [])
            .map((i) => parts[i]?._id)
            .filter(Boolean);
        if (ids.length) out.push(newGroup(String(g.name ?? 'Group'), ids));
    }

    return out;
}
