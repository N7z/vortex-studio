const MAX_NAME = 64;

const okId = (v) => typeof v === 'string' && !!v && v.length <= MAX_NAME;

const okParent = (v) => v === undefined || v === null || okId(v);

// A group may sit inside another group. Walking up from the would-be parent has to reach the top
// without meeting the group being moved, or the two would point at each other and orphan a subtree.
function wouldCycle(groups, id, parent) {
    const byId = new Map(groups.map((g) => [g.id, g]));
    let at = parent;
    for (let hops = 0; at && hops <= groups.length; hops += 1) {
        if (at === id) return true;
        at = byId.get(at)?.parent ?? null;
    }

    return false;
}

const parentOf = (groups, id) => groups.find((g) => g.id === id)?.parent ?? null;

export function validateGroupOp(op, maxGroups) {
    if (!op || typeof op !== 'object') return 'op must be an object';
    switch (op.t) {
        case 'group': {
            if (!okId(op.id)) return 'group needs an id';
            if (typeof op.name !== 'string' || op.name.length > MAX_NAME) return 'bad group name';
            if (!Array.isArray(op.ids) || !op.ids.length) return 'group needs ids';
            if (op.ids.length > maxGroups * MAX_NAME) return 'too many ids';
            if (!op.ids.every(okId)) return 'bad part id';
            if (new Set(op.ids).size !== op.ids.length) return 'duplicate part id';
            if (!okParent(op.parent)) return 'bad parent group';

            return null;
        }
        case 'ungroup':
            if (!Array.isArray(op.ids) || !op.ids.length || !op.ids.every(okId)) return 'ungroup needs ids';

            return null;
        case 'rename':
            if (!okId(op.id)) return 'rename needs an id';
            if (typeof op.name !== 'string' || op.name.length > MAX_NAME) return 'bad group name';

            return null;
        case 'delete':
            if (!okId(op.id)) return 'delete needs an id';

            return null;
        case 'reparent':
            if (!okId(op.id)) return 'reparent needs an id';
            if (!okParent(op.parent)) return 'bad parent group';
            if (op.parent === op.id) return 'a group cannot hold itself';

            return null;
        default:
            return 'unknown group op';
    }
}

// A group is worth keeping while it still holds parts or still holds another group. Parents that
// point at something that is gone are cleared rather than dropping the group with them.
export function pruneEmptyGroups(groups) {
    let out = groups;
    for (let pass = 0; pass < 2; pass += 1) {
        const parents = new Set(out.map((g) => g.parent).filter(Boolean));
        const next = out.filter((g) => g.ids.length || parents.has(g.id));
        if (next.length === out.length) break;
        out = next;
    }
    const alive = new Set(out.map((g) => g.id));

    return out.map((g) => {
        if (!g.parent) return g;
        if (alive.has(g.parent) && !wouldCycle(out, g.id, g.parent)) return g;
        const { parent, ...rest } = g;

        return rest;
    });
}

export function applyGroupOp(groups, op) {
    switch (op?.t) {
        case 'group': {
            const taken = new Set(op.ids);
            const kept = groups
                .filter((g) => g.id !== op.id)
                .map((g) => (g.ids.some((id) => taken.has(id))
                    ? { ...g, ids: g.ids.filter((id) => !taken.has(id)) }
                    : g));

            const parent = wouldCycle(kept, op.id, op.parent ?? null) ? null : (op.parent ?? null);

            return pruneEmptyGroups([...kept, {
                id: op.id, name: op.name, ids: [...op.ids], ...(parent ? { parent } : {}),
            }]);
        }
        case 'ungroup': {
            const touched = new Set(op.ids);
            const out = groups.filter((g) => !g.ids.some((id) => touched.has(id)));

            return out.length === groups.length ? groups : out;
        }
        case 'rename': {
            let hit = false;
            const out = groups.map((g) => {
                if (g.id !== op.id || g.name === op.name) return g;
                hit = true;

                return { ...g, name: op.name };
            });

            return hit ? out : groups;
        }
        case 'delete': {
            const out = groups.filter((g) => g.id !== op.id);
            if (out.length === groups.length) return groups;

            // Deleting a folder must not strand what was inside it: its groups move up one level.
            const up = parentOf(groups, op.id);

            return out.map((g) => {
                if (g.parent !== op.id) return g;

                return up ? { ...g, parent: up } : (({ parent, ...rest }) => rest)(g);
            });
        }
        case 'reparent': {
            const target = groups.find((g) => g.id === op.id);
            if (!target) return groups;
            const next = op.parent ?? null;
            if ((target.parent ?? null) === next) return groups;
            if (next && (!groups.some((g) => g.id === next) || wouldCycle(groups, op.id, next))) {
                return groups;
            }

            return groups.map((g) => {
                if (g.id !== op.id) return g;

                return next ? { ...g, parent: next } : (({ parent, ...rest }) => rest)(g);
            });
        }
        default:
            return groups;
    }
}
