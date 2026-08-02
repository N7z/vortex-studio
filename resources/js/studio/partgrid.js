const MIN_CELL = 2;
const MAX_CELL = 64;
const SPREAD = 4;
const MAX_CELLS = 200000;

export function distanceToBox(part, at) {
    let d = 0;
    for (let i = 0; i < 3; i++) {
        const gap = Math.abs(at[i] - part.P[i]) - Math.abs(part.S[i]) / 2;
        if (gap > 0) d += gap * gap;
    }
    return Math.sqrt(d);
}

export function buildGrid(parts) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of parts) {
        for (let i = 0; i < 3; i++) {
            lo = Math.min(lo, p.P[i]);
            hi = Math.max(hi, p.P[i]);
        }
    }
    const span = Number.isFinite(lo) ? Math.max(hi - lo, 1) : 1;
    const cell = Math.min(MAX_CELL, Math.max(
        MIN_CELL, 2 * ((span ** 3 / Math.max(parts.length, 1)) ** (1 / 3)),
    ));

    const cells = new Map();
    const big = [];
    const put = (key, part) => {
        const at = cells.get(key);
        if (at) at.push(part);
        else cells.set(key, [part]);
    };
    for (const part of parts) {
        const x0 = Math.floor((part.P[0] - Math.abs(part.S[0]) / 2) / cell);
        const x1 = Math.floor((part.P[0] + Math.abs(part.S[0]) / 2) / cell);
        const y0 = Math.floor((part.P[1] - Math.abs(part.S[1]) / 2) / cell);
        const y1 = Math.floor((part.P[1] + Math.abs(part.S[1]) / 2) / cell);
        const z0 = Math.floor((part.P[2] - Math.abs(part.S[2]) / 2) / cell);
        const z1 = Math.floor((part.P[2] + Math.abs(part.S[2]) / 2) / cell);
        if (x1 - x0 > SPREAD || y1 - y0 > SPREAD || z1 - z0 > SPREAD) {
            big.push(part);
            continue;
        }
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                for (let z = z0; z <= z1; z++) put(`${x},${y},${z}`, part);
            }
        }
    }

    return { parts, cell, cells, big };
}

export function nearGrid(grid, at, radius, visit) {
    const { cell, cells, big } = grid;
    const x0 = Math.floor((at[0] - radius) / cell);
    const x1 = Math.floor((at[0] + radius) / cell);
    const y0 = Math.floor((at[1] - radius) / cell);
    const y1 = Math.floor((at[1] + radius) / cell);
    const z0 = Math.floor((at[2] - radius) / cell);
    const z1 = Math.floor((at[2] + radius) / cell);
    const wide = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MAX_CELLS;

    const offer = (part) => {
        const d = distanceToBox(part, at);
        return d > radius ? true : visit(part, d / radius);
    };

    if (wide) {
        for (const part of grid.parts) if (!offer(part)) return;
        return;
    }
    for (const part of big) if (!offer(part)) return;
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
                const list = cells.get(`${x},${y},${z}`);
                if (!list) continue;
                for (const part of list) if (!offer(part)) return;
            }
        }
    }
}
