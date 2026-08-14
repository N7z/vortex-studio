import { validPointLight, validSpotLight } from './lights.js';

export const PART_KEYS = [
    '_id', 'T', 'N', 'P', 'S', 'R', 'C', 'Tr', 'Shape', 'Sh', 'ItemId',
    'M', 'Cs', 'An', 'Cc', 'Bp', 'Tx', 'point_light', 'spot_light',
];

const VEC_KEYS = ['P', 'S', 'R'];

export const MATERIALS = ['Plastic', 'Wood', 'Metal', 'Grass', 'Ice', 'Paint'];

export const FACES = ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'];

export const TEXTURES = ['Studs', 'Inlets'];

const BOOL_KEYS = ['Cs', 'An', 'Cc', 'Bp'];

export function validFaceTextures(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    for (const [face, kind] of Object.entries(v)) {
        if (!FACES.includes(face) || !TEXTURES.includes(kind)) return false;
    }

    return true;
}

export function applyOp(parts, op) {
    switch (op?.t) {
        case 'add': {
            const ids = new Set(op.items.map((it) => it.part._id));
            const out = parts.filter((p) => !ids.has(p._id));
            for (const it of [...op.items].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))) {
                const at = Number.isInteger(it.at) ? Math.max(0, Math.min(it.at, out.length)) : out.length;
                out.splice(at, 0, it.part);
            }

            return out;
        }
        case 'set': {
            const byId = new Map(op.items.map((it) => [it.id, it]));
            if (!parts.some((p) => byId.has(p._id))) return parts;

            return parts.map((p) => {
                const it = byId.get(p._id);
                if (!it) return p;
                const next = { ...p, ...(it.fields ?? {}) };
                for (const k of it.unset ?? []) delete next[k];

                return next;
            });
        }
        case 'remove': {
            const ids = new Set(op.ids);
            const out = parts.filter((p) => !ids.has(p._id));

            return out.length === parts.length ? parts : out;
        }
        case 'replace':
            return op.parts.slice();
        default:
            return parts;
    }
}

export function invertOp(parts, op) {
    switch (op?.t) {
        case 'add': {
            const have = new Set(parts.map((p) => p._id));
            const fresh = op.items.filter((it) => !have.has(it.part._id));

            return fresh.length ? { t: 'remove', ids: fresh.map((it) => it.part._id) } : null;
        }
        case 'set': {
            const before = new Map(parts.map((p) => [p._id, p]));
            const items = [];
            for (const it of op.items) {
                const part = before.get(it.id);
                if (!part) continue;
                const fields = {};
                const unset = [];
                for (const k of Object.keys(it.fields ?? {})) {
                    if (k in part) fields[k] = part[k];
                    else unset.push(k);
                }
                for (const k of it.unset ?? []) {
                    if (k in part) fields[k] = part[k];
                }
                if (Object.keys(fields).length || unset.length) items.push({ id: it.id, fields, unset });
            }

            return items.length ? { t: 'set', items } : null;
        }
        case 'remove': {
            const ids = new Set(op.ids);
            const items = [];
            parts.forEach((p, at) => {
                if (ids.has(p._id)) items.push({ part: p, at });
            });

            return items.length ? { t: 'add', items } : null;
        }
        case 'replace':
            return { t: 'replace', parts: parts.slice() };
        default:
            return null;
    }
}

export function opIds(op) {
    switch (op?.t) {
        case 'add': return op.items.map((it) => it.part?._id);
        case 'set': return op.items.map((it) => it.id);
        case 'remove': return op.ids.slice();
        default: return [];
    }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validPart(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    for (const k of Object.keys(p)) {
        if (!PART_KEYS.includes(k)) return false;
    }
    if (typeof p._id !== 'string' || !p._id || p._id.length > 64) return false;
    if (typeof p.T !== 'string' || !p.T || p.T.length > 32) return false;
    // A part can be called whatever its builder wants; without a name it goes by its type.
    if ('N' in p && (typeof p.N !== 'string' || !p.N || p.N.length > 64)) return false;
    for (const k of VEC_KEYS) {
        const v = p[k];
        if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) return false;
    }
    if ('C' in p && (typeof p.C !== 'string' || !/^[0-9a-fA-F]{0,6}$/.test(p.C))) return false;
    if ('Tr' in p && (!isNum(p.Tr) || p.Tr < 0 || p.Tr > 1)) return false;
    for (const k of ['Shape', 'Sh']) {
        if (k in p && (typeof p[k] !== 'string' || p[k].length > 32)) return false;
    }
    if ('ItemId' in p && p.ItemId !== null && !Number.isInteger(p.ItemId)) return false;
    if ('M' in p && !MATERIALS.includes(p.M)) return false;
    for (const k of BOOL_KEYS) {
        if (k in p && typeof p[k] !== 'boolean') return false;
    }
    if ('Tx' in p && !validFaceTextures(p.Tx)) return false;
    // A light sits on the part rather than beside it, so it travels with the part and there is at
    // most one of each kind.
    if (p.point_light != null && !validPointLight(p.point_light)) return false;
    if (p.spot_light != null && !validSpotLight(p.spot_light)) return false;

    return true;
}

const SETTABLE = PART_KEYS.filter((k) => k !== '_id');

export function validateOp(op, partLimit) {
    if (!op || typeof op !== 'object') return 'op must be an object';
    switch (op.t) {
        case 'add': {
            if (!Array.isArray(op.items) || !op.items.length) return 'add needs items';
            if (op.items.length > partLimit) return 'too many parts in one op';
            const seen = new Set();
            for (const it of op.items) {
                if (!it || typeof it !== 'object') return 'bad add item';
                if (!validPart(it.part)) return 'bad part data';
                if (it.at !== undefined && it.at !== null && !Number.isInteger(it.at)) return 'bad insert index';
                if (seen.has(it.part._id)) return 'duplicate id in one op';
                seen.add(it.part._id);
            }

            return null;
        }
        case 'set': {
            if (!Array.isArray(op.items) || !op.items.length) return 'set needs items';
            if (op.items.length > partLimit) return 'too many items in one op';
            for (const it of op.items) {
                if (!it || typeof it !== 'object' || typeof it.id !== 'string') return 'bad set item';
                const fields = it.fields ?? {};
                if (typeof fields !== 'object' || Array.isArray(fields)) return 'bad set fields';
                for (const k of Object.keys(fields)) {
                    if (!SETTABLE.includes(k)) return `field ${k} is not settable`;
                }
                if (it.unset !== undefined) {
                    if (!Array.isArray(it.unset)) return 'bad unset list';
                    for (const k of it.unset) {
                        if (!SETTABLE.includes(k)) return `field ${k} is not settable`;
                    }
                }
                const probe = { _id: it.id, T: 'Part', P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0], ...fields };
                for (const k of it.unset ?? []) delete probe[k];
                if (!validPart(probe)) return 'bad field value';
            }

            return null;
        }
        case 'remove':
            if (!Array.isArray(op.ids) || !op.ids.length) return 'remove needs ids';
            if (op.ids.length > partLimit) return 'too many ids in one op';
            if (!op.ids.every((id) => typeof id === 'string')) return 'bad id';

            return null;
        case 'replace':
            if (!Array.isArray(op.parts)) return 'replace needs parts';
            if (op.parts.length > partLimit) return 'map too large';
            if (!op.parts.every(validPart)) return 'bad part data';
            if (new Set(op.parts.map((p) => p._id)).size !== op.parts.length) return 'duplicate ids';

            return null;
        default:
            return `unknown op ${String(op.t)}`;
    }
}
