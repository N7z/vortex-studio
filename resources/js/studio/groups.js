let seq = 0;

export const newGroup = (name, ids) => ({
    id: `g-${++seq}`,
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

// Stored by position in the part list, not by part id: ids are handed out fresh
// on every open, so a stored id would point at nothing.
const KEY = 'studio_groups';

const readAll = () => {
    try {
        const all = JSON.parse(localStorage.getItem(KEY));
        return all && typeof all === 'object' ? all : {};
    } catch {
        return {};
    }
};

export function loadGroups(mapName, parts) {
    if (!mapName) return [];
    const stored = readAll()[mapName];
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

export function saveGroups(mapName, groups, parts) {
    if (!mapName) return;
    const index = new Map(parts.map((p, i) => [p._id, i]));
    const all = readAll();
    if (groups.length) {
        all[mapName] = groups.map((g) => ({
            name: g.name,
            idx: g.ids.map((id) => index.get(id)).filter((i) => i !== undefined),
        })).filter((g) => g.idx.length);
    } else {
        delete all[mapName];
    }
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        /* ignore */
    }
}

export function forgetGroups(mapName) {
    const all = readAll();
    if (!(mapName in all)) return;
    delete all[mapName];
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* ignore */ }
}
