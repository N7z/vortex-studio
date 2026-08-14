
export const DEG = Math.PI / 180;

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

export function regionBounds(r) {
    return {
        minX: r.x,
        minY: r.y,
        minZ: r.z,
        maxX: r.x + r.width,
        maxY: r.y + r.height,
        maxZ: r.z + r.depth,
    };
}

export function regionCentre(r) {
    return [r.x + r.width / 2, r.y + r.height / 2, r.z + r.depth / 2];
}

export function boxOfRegion(r, fields = {}) {
    return {
        T: 'Part',
        P: regionCentre(r),
        S: [r.width, r.height, r.depth],
        R: [0, 0, 0],
        ...fields,
    };
}

export function partBounds(part) {
    const [px, py, pz] = part.P;
    const [sx, sy, sz] = part.S;
    const [rx, ry, rz] = part.R ?? [0, 0, 0];

    if (!rx && !ry && !rz) {
        return {
            minX: px - sx / 2,
            maxX: px + sx / 2,
            minY: py - sy / 2,
            maxY: py + sy / 2,
            minZ: pz - sz / 2,
            maxZ: pz + sz / 2,
        };
    }

    const m = rotationMatrix(rx, ry, rz);
    const ex = (Math.abs(m[0]) * sx + Math.abs(m[1]) * sy + Math.abs(m[2]) * sz) / 2;
    const ey = (Math.abs(m[3]) * sx + Math.abs(m[4]) * sy + Math.abs(m[5]) * sz) / 2;
    const ez = (Math.abs(m[6]) * sx + Math.abs(m[7]) * sy + Math.abs(m[8]) * sz) / 2;

    return {
        minX: px - ex, maxX: px + ex, minY: py - ey, maxY: py + ey, minZ: pz - ez, maxZ: pz + ez,
    };
}

export function rotationMatrix(rx, ry, rz) {
    const cx = Math.cos(rx * DEG);
    const sx = Math.sin(rx * DEG);
    const cy = Math.cos(ry * DEG);
    const sy = Math.sin(ry * DEG);
    const cz = Math.cos(rz * DEG);
    const sz = Math.sin(rz * DEG);

    return [
        cy * cz, -cy * sz, sy,
        cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
        sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy,
    ];
}

export function overlaps(a, b, tolerance = 0) {
    return a.minX < b.maxX - tolerance && a.maxX > b.minX + tolerance
        && a.minY < b.maxY - tolerance && a.maxY > b.minY + tolerance
        && a.minZ < b.maxZ - tolerance && a.maxZ > b.minZ + tolerance;
}

export function intersectionVolume(a, b) {
    const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    const d = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);

    return w > 0 && h > 0 && d > 0 ? w * h * d : 0;
}

export function boundsOf(parts) {
    if (!parts.length) return null;
    const out = {
        minX: Infinity,
        minY: Infinity,
        minZ: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        maxZ: -Infinity,
    };
    for (const p of parts) {
        const b = partBounds(p);
        if (b.minX < out.minX) out.minX = b.minX;
        if (b.minY < out.minY) out.minY = b.minY;
        if (b.minZ < out.minZ) out.minZ = b.minZ;
        if (b.maxX > out.maxX) out.maxX = b.maxX;
        if (b.maxY > out.maxY) out.maxY = b.maxY;
        if (b.maxZ > out.maxZ) out.maxZ = b.maxZ;
    }

    return out;
}

export const boundsSize = (b) => [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ];

export const boundsCentre = (b) => [
    (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2,
];

export function partsInRegion(parts, region, mode = 'overlap') {
    const box = regionBounds(region);

    return parts.filter((p) => {
        const b = partBounds(p);
        if (mode === 'contain') {
            return b.minX >= box.minX && b.maxX <= box.maxX
                && b.minY >= box.minY && b.maxY <= box.maxY
                && b.minZ >= box.minZ && b.maxZ <= box.maxZ;
        }

        return overlaps(b, box);
    });
}

export function rng(seed) {
    let s = (Math.floor(seed) || 1) >>> 0;

    return () => {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5;
        s >>>= 0;

        return s / 0x100000000;
    };
}

export const round = (v, places = 3) => {
    const f = 10 ** places;

    return Math.round(v * f) / f;
};

export const roundVec = (v, places = 3) => v.map((n) => round(n, places));
