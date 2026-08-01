// Lock and hide. Editor-only: they are kept in this browser, keyed by map, and
// never reach the saved document or the exported .json. When the engine carries
// them per part, `has` reads `part.Lk`/`part.Hd` and `apply` returns a patchOp
// instead of a store write; nothing outside this module touches either.

export const KINDS = ['lock', 'hide'];

const KEY = 'studio_flags';
const MAX_MAPS = 60;

export const EMPTY = { lock: new Set(), hide: new Set() };

export const mapKey = (name, team = null) => (name ? `${team == null ? '' : `t${team}:`}${name}` : null);

const readStore = () => {
    try {
        const all = JSON.parse(localStorage.getItem(KEY));
        return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
        return {};
    }
};

const idList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export function load(key) {
    if (!key) return EMPTY;
    const row = readStore()[key];
    if (!row) return EMPTY;

    return { lock: new Set(idList(row.lock)), hide: new Set(idList(row.hide)) };
}

export function save(key, flags) {
    if (!key) return;
    const all = readStore();
    const empty = KINDS.every((k) => !flags[k].size);
    if (empty) delete all[key];
    else all[key] = { at: Date.now(), lock: [...flags.lock], hide: [...flags.hide] };

    const keys = Object.keys(all);
    if (keys.length > MAX_MAPS) {
        keys.sort((a, b) => (all[a].at ?? 0) - (all[b].at ?? 0));
        for (const k of keys.slice(0, keys.length - MAX_MAPS)) delete all[k];
    }
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* a full quota must not break editing */ }
}

const idOf = (part) => (typeof part === 'string' ? part : part?._id);

export const isLocked = (flags, part) => flags.lock.has(idOf(part));
export const isHidden = (flags, part) => flags.hide.has(idOf(part));

export function apply(flags, kind, ids, on) {
    const next = new Set(flags[kind]);
    for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
    }
    if (next.size === flags[kind].size) return flags;

    return { ...flags, [kind]: next };
}

export function clear(flags, kind) {
    if (!flags[kind].size) return flags;

    return { ...flags, [kind]: new Set() };
}

export function prune(flags, parts) {
    const alive = new Set(parts.map((p) => p._id));
    let out = flags;
    for (const kind of KINDS) {
        const kept = [...out[kind]].filter((id) => alive.has(id));
        if (kept.length !== out[kind].size) out = { ...out, [kind]: new Set(kept) };
    }

    return out;
}

export const selectable = (flags, ids) => ids.filter((id) => !flags.lock.has(id) && !flags.hide.has(id));
