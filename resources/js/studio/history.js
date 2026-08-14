// A slider fires all the way down its track, and a colour picker fires on every nudge. Edits that
// keep touching the same fields on the same selection are one move as far as undo is concerned,
// until the hand pauses.
export const COALESCE_MS = 600;

export function editKey(op) {
    if (op?.t !== 'set' || !Array.isArray(op.items)) return null;
    const ids = op.items.map((it) => it.id).join(',');
    const fields = [...new Set(op.items.flatMap((it) => [
        ...Object.keys(it.fields ?? {}), ...(it.unset ?? []).map((k) => `-${k}`),
    ]))].sort().join(',');

    return `set:${ids}:${fields}`;
}

export const lightingKey = (patch) => `lighting:${Object.keys(patch).sort().join(',')}`;

// Whether this edit carries on the one before it, rather than starting its own undo step.
export const continues = (last, key, now) => !!key
    && last.key === key
    && now - last.at < COALESCE_MS;
