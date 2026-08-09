const MAX_NAME = 64;

const okId = (v) => typeof v === 'string' && !!v && v.length <= MAX_NAME;

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
        default:
            return 'unknown group op';
    }
}

export function applyGroupOp(groups, op) {
    switch (op?.t) {
        case 'group': {
            const taken = new Set(op.ids);
            const kept = groups
                .filter((g) => g.id !== op.id)
                .map((g) => (g.ids.some((id) => taken.has(id))
                    ? { ...g, ids: g.ids.filter((id) => !taken.has(id)) }
                    : g))
                .filter((g) => g.ids.length);

            return [...kept, { id: op.id, name: op.name, ids: [...op.ids] }];
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

            return out.length === groups.length ? groups : out;
        }
        default:
            return groups;
    }
}
