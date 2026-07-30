import { PART_KEYS } from '../../../live-editing-server/src/ops.js';

export {
    PART_KEYS, applyOp, invertOp, opIds, validPart,
} from '../../../live-editing-server/src/ops.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const VEC_DEFAULT = { P: [0, 0, 0], S: [1, 1, 1], R: [0, 0, 0] };

const okType = (v) => typeof v === 'string' && !!v && v.length <= 32;
const okColor = (v) => typeof v === 'string' && /^[0-9a-fA-F]{0,6}$/.test(v);
const okTr = (v) => isNum(v) && v >= 0 && v <= 1;
const hasShape = (p) => okType(p?.Shape) || okType(p?.Sh);

export function fillPart(part, source) {
    const out = { ...part };
    if (!okType(out.T)) out.T = okType(source?.T) ? source.T : 'Part';
    if (!okColor(out.C)) out.C = okColor(source?.C) ? source.C : 'a3a2a5';
    if (!okTr(out.Tr)) out.Tr = okTr(source?.Tr) ? source.Tr : 0;
    if (!hasShape(out)) {
        if (okType(source?.Shape)) out.Shape = source.Shape;
        else if (okType(source?.Sh)) out.Sh = source.Sh;
        else out.Shape = 'Block';
    }
    for (const k of ['P', 'S', 'R']) {
        const v = out[k];
        if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) out[k] = [...VEC_DEFAULT[k]];
    }

    return out;
}

export function repairParts(parts) {
    let fixed = 0;
    const out = parts.map((p) => {
        const clean = { _id: p._id };
        for (const k of PART_KEYS) if (k in p) clean[k] = p[k];
        let bad = Object.keys(p).some((k) => k !== '_id' && !PART_KEYS.includes(k));

        if (!okType(clean.T) || !okColor(clean.C) || !okTr(clean.Tr) || !hasShape(clean)) bad = true;
        for (const k of ['P', 'S', 'R']) {
            const v = clean[k];
            if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) bad = true;
        }
        for (const k of ['Shape', 'Sh']) {
            if (k in clean && !okType(clean[k])) {
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
        return fillPart(clean, null);
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
