import * as THREE from 'three';

const DEG = Math.PI / 180;
const round = (v) => Math.round(v * 1000) / 1000;

const euler = new THREE.Euler();
const mat = new THREE.Matrix4();

export function extents(part) {
    const [rx, ry, rz] = part.R;
    if (!rx && !ry && !rz) return part.S.map((s) => Math.abs(s) / 2);
    euler.set(rx * DEG, ry * DEG, rz * DEG);
    mat.makeRotationFromEuler(euler);
    const m = mat.elements;
    const half = part.S.map((s) => Math.abs(s) / 2);

    return [0, 1, 2].map((row) => (
        Math.abs(m[row]) * half[0] + Math.abs(m[4 + row]) * half[1] + Math.abs(m[8 + row]) * half[2]
    ));
}

export function bounds(part) {
    const half = extents(part);

    return {
        min: [0, 1, 2].map((i) => part.P[i] - half[i]),
        max: [0, 1, 2].map((i) => part.P[i] + half[i]),
        size: half.map((h) => h * 2),
    };
}

export function selectionBounds(parts) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
        const b = bounds(p);
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], b.min[i]);
            max[i] = Math.max(max[i], b.max[i]);
        }
    }

    return { min, max };
}

const move = (part, axis, value) => {
    const next = round(value);
    if (next === round(part.P[axis])) return null;
    const P = [...part.P];
    P[axis] = next;

    return { id: part._id, P };
};

const clean = (list) => list.filter(Boolean);

export function alignUpdates(parts, axis, mode) {
    if (parts.length < 2) return [];
    const { min, max } = selectionBounds(parts);
    const mid = (min[axis] + max[axis]) / 2;

    return clean(parts.map((p) => {
        const half = extents(p)[axis];
        if (mode === 'min') return move(p, axis, min[axis] + half);
        if (mode === 'max') return move(p, axis, max[axis] - half);

        return move(p, axis, mid);
    }));
}

export function distributeUpdates(parts, axis) {
    if (parts.length < 3) return [];
    const rows = parts
        .map((p) => ({ p, b: bounds(p) }))
        .sort((a, b) => (a.b.min[axis] + a.b.max[axis]) - (b.b.min[axis] + b.b.max[axis]));
    const span = rows[rows.length - 1].b.max[axis] - rows[0].b.min[axis];
    const filled = rows.reduce((n, r) => n + r.b.size[axis], 0);
    const gap = (span - filled) / (rows.length - 1);

    const out = [];
    let cursor = rows[0].b.max[axis] + gap;
    for (let i = 1; i < rows.length - 1; i++) {
        const { p, b } = rows[i];
        out.push(move(p, axis, cursor + b.size[axis] / 2));
        cursor += b.size[axis] + gap;
    }

    return clean(out);
}

export function spaceUpdates(parts, axis, gap) {
    if (parts.length < 2) return [];
    const rows = parts
        .map((p) => ({ p, b: bounds(p) }))
        .sort((a, b) => (a.b.min[axis] + a.b.max[axis]) - (b.b.min[axis] + b.b.max[axis]));

    const out = [];
    let cursor = rows[0].b.max[axis] + gap;
    for (let i = 1; i < rows.length; i++) {
        const { p, b } = rows[i];
        out.push(move(p, axis, cursor + b.size[axis] / 2));
        cursor += b.size[axis] + gap;
    }

    return clean(out);
}

const overlaps = (a, b, axis) => a.min[axis] < b.max[axis] - 1e-4 && a.max[axis] > b.min[axis] + 1e-4;

export function dropUpdates(parts, all, floor = 0) {
    const moving = new Set(parts.map((p) => p._id));
    const below = all
        .filter((p) => !moving.has(p._id))
        .map((p) => bounds(p));

    return clean(parts.map((p) => {
        const b = bounds(p);
        let top = floor;
        for (const o of below) {
            if (o.max[1] > b.min[1] + 1e-3) continue;
            if (!overlaps(b, o, 0) || !overlaps(b, o, 2)) continue;
            if (o.max[1] > top) top = o.max[1];
        }

        return move(p, 1, top + (b.max[1] - b.min[1]) / 2);
    }));
}
