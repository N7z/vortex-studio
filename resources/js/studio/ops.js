import { PART_KEYS } from '../../../live-editing-server/src/ops.js';

export {
    PART_KEYS, applyOp, invertOp, opIds, validPart,
} from '../../../live-editing-server/src/ops.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const VEC_DEFAULT = { P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0] };

export function repairParts(parts) {
    let fixed = 0;
    const out = parts.map((p) => {
        const clean = { _id: p._id };
        for (const k of PART_KEYS) if (k in p) clean[k] = p[k];
        let bad = Object.keys(p).some((k) => k !== '_id' && !PART_KEYS.includes(k));

        if (typeof clean.T !== 'string' || !clean.T || clean.T.length > 32) {
            clean.T = 'Part';
            bad = true;
        }
        for (const k of ['P', 'S', 'R']) {
            const v = clean[k];
            if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) {
                clean[k] = [...VEC_DEFAULT[k]];
                bad = true;
            }
        }
        if ('C' in clean && (typeof clean.C !== 'string' || !/^[0-9a-fA-F]{0,6}$/.test(clean.C))) {
            delete clean.C;
            bad = true;
        }
        if ('Tr' in clean && (!isNum(clean.Tr) || clean.Tr < 0 || clean.Tr > 1)) {
            delete clean.Tr;
            bad = true;
        }
        for (const k of ['Shape', 'Sh']) {
            if (k in clean && (typeof clean[k] !== 'string' || clean[k].length > 32)) {
                delete clean[k];
                bad = true;
            }
        }
        if ('ItemId' in clean && clean.ItemId !== null && !Number.isInteger(clean.ItemId)) {
            delete clean.ItemId;
            bad = true;
        }

        if (!bad) return p;
        fixed += 1;
        return clean;
    });

    return { parts: out, fixed };
}

const TAB = Math.random().toString(36).slice(2, 8);
let seq = 0;

export function newPartId() {
    seq += 1;

    return `${TAB}-${seq}`;
}

export const withNewId = (part) => ({ ...part, _id: newPartId() });

export const stripIds = (parts) => parts.map(({ _id, ...rest }) => rest);

export const addOp = (parts) => ({ t: 'add', items: parts.map((part) => ({ part })) });

export const removeOp = (ids) => ({ t: 'remove', ids: [...ids] });

export const patchOp = (ids, fields) => ({
    t: 'set',
    items: [...ids].map((id) => ({ id, fields })),
});

export const transformOp = (updates) => ({
    t: 'set',
    items: updates.map(({ id, ...fields }) => ({ id, fields })),
});
