export {
    PART_KEYS, applyOp, invertOp, opIds, validPart,
} from '../../../live-editing-server/src/ops.js';

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
