const DEG = Math.PI / 180;
const CELL = 16;
const HUGE = 256;
const GROUND_REACH = 1;

function eulerMatrix(rx, ry, rz) {
    const cx = Math.cos(rx); const sx = Math.sin(rx);
    const cy = Math.cos(ry); const sy = Math.sin(ry);
    const cz = Math.cos(rz); const sz = Math.sin(rz);
    return [
        cy * cz, -cy * sz, sy,
        cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
        sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy,
    ];
}

export function buildWorld(parts) {
    const solid = [];
    for (const p of parts) {
        if (!Array.isArray(p.P) || !Array.isArray(p.S)) continue;
        const [px, py, pz] = p.P;
        const [sx, sy, sz] = p.S;
        if (!(sx > 0 && sy > 0 && sz > 0)) continue;
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
        solid.push(p);
    }

    const n = solid.length;
    const cx = new Float32Array(n); const cy = new Float32Array(n); const cz = new Float32Array(n);
    const hx = new Float32Array(n); const hy = new Float32Array(n); const hz = new Float32Array(n);
    const minX = new Float32Array(n); const minY = new Float32Array(n); const minZ = new Float32Array(n);
    const maxX = new Float32Array(n); const maxY = new Float32Array(n); const maxZ = new Float32Array(n);
    const rotated = new Uint8Array(n);
    const rot = new Float32Array(n * 9);

    for (let i = 0; i < n; i++) {
        const p = solid[i];
        cx[i] = p.P[0]; cy[i] = p.P[1]; cz[i] = p.P[2];
        hx[i] = p.S[0] / 2; hy[i] = p.S[1] / 2; hz[i] = p.S[2] / 2;

        const r = p.R;
        const rx = r?.[0] ? r[0] * DEG : 0;
        const ry = r?.[1] ? r[1] * DEG : 0;
        const rz = r?.[2] ? r[2] * DEG : 0;
        if (rx || ry || rz) {
            rotated[i] = 1;
            const m = eulerMatrix(rx, ry, rz);
            for (let k = 0; k < 9; k++) rot[i * 9 + k] = m[k];
            const ex = Math.abs(m[0]) * hx[i] + Math.abs(m[1]) * hy[i] + Math.abs(m[2]) * hz[i];
            const ey = Math.abs(m[3]) * hx[i] + Math.abs(m[4]) * hy[i] + Math.abs(m[5]) * hz[i];
            const ez = Math.abs(m[6]) * hx[i] + Math.abs(m[7]) * hy[i] + Math.abs(m[8]) * hz[i];
            minX[i] = cx[i] - ex; maxX[i] = cx[i] + ex;
            minY[i] = cy[i] - ey; maxY[i] = cy[i] + ey;
            minZ[i] = cz[i] - ez; maxZ[i] = cz[i] + ez;
        } else {
            minX[i] = cx[i] - hx[i]; maxX[i] = cx[i] + hx[i];
            minY[i] = cy[i] - hy[i]; maxY[i] = cy[i] + hy[i];
            minZ[i] = cz[i] - hz[i]; maxZ[i] = cz[i] + hz[i];
        }
    }

    const cells = new Map();
    const always = [];
    const key = (gx, gz) => (gx * 73856093) ^ (gz * 19349663);

    for (let i = 0; i < n; i++) {
        if (maxX[i] - minX[i] > HUGE || maxZ[i] - minZ[i] > HUGE) {
            always.push(i);
            continue;
        }
        const gx0 = Math.floor(minX[i] / CELL); const gx1 = Math.floor(maxX[i] / CELL);
        const gz0 = Math.floor(minZ[i] / CELL); const gz1 = Math.floor(maxZ[i] / CELL);
        for (let gx = gx0; gx <= gx1; gx++) {
            for (let gz = gz0; gz <= gz1; gz++) {
                const k = key(gx, gz);
                let bucket = cells.get(k);
                if (!bucket) { bucket = []; cells.set(k, bucket); }
                bucket.push(i);
            }
        }
    }

    const hit = { y: 0, nx: 0, ny: 1, nz: 0 };

    function rayTop(i, x, z, fromY) {
        const o = i * 9;
        const dx = x - cx[i];
        const dz = z - cz[i];
        const dy = fromY - cy[i];
        const lx = rot[o] * dx + rot[o + 3] * dy + rot[o + 6] * dz;
        const ly = rot[o + 1] * dx + rot[o + 4] * dy + rot[o + 7] * dz;
        const lz = rot[o + 2] * dx + rot[o + 5] * dy + rot[o + 8] * dz;
        const ddx = -rot[o + 3];
        const ddy = -rot[o + 4];
        const ddz = -rot[o + 5];

        let tEnter = -Infinity;
        let tExit = Infinity;
        let axis = -1;
        let sign = 1;

        const slab = (p, d, h, a) => {
            if (Math.abs(d) < 1e-9) return p >= -h && p <= h;
            let t1 = (-h - p) / d;
            let t2 = (h - p) / d;
            let s = -1;
            if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
            if (t1 > tEnter) { tEnter = t1; axis = a; sign = s; }
            if (t2 < tExit) tExit = t2;
            return tEnter <= tExit;
        };
        if (!slab(lx, ddx, hx[i], 0)) return false;
        if (!slab(ly, ddy, hy[i], 1)) return false;
        if (!slab(lz, ddz, hz[i], 2)) return false;
        if (tExit < 0 || axis < 0) return false;

        hit.y = fromY - Math.max(tEnter, 0);
        const c = o + axis;
        let nx = rot[c] * sign;
        let ny = rot[c + 3] * sign;
        let nz = rot[c + 6] * sign;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        hit.nx = nx;
        hit.ny = ny;
        hit.nz = nz;
        return true;
    }

    function groundAt(x, z, headY, feet, out) {
        const lowest = feet - GROUND_REACH;
        let found = false;

        const scan = (list) => {
            for (let j = 0; j < list.length; j++) {
                const i = list[j];
                if (maxY[i] < lowest || minY[i] > headY) continue;
                if (x < minX[i] || x > maxX[i] || z < minZ[i] || z > maxZ[i]) continue;
                if (rotated[i]) {
                    if (!rayTop(i, x, z, headY)) continue;
                } else {
                    hit.y = maxY[i];
                    hit.nx = 0; hit.ny = 1; hit.nz = 0;
                }
                if (hit.y < lowest || hit.y > headY) continue;
                if (found && hit.y <= out.y) continue;
                found = true;
                out.y = hit.y;
                out.nx = hit.nx;
                out.ny = hit.ny;
                out.nz = hit.nz;
            }
        };

        const bucket = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (bucket) scan(bucket);
        if (always.length) scan(always);
        return found;
    }

    function insideBox(i, x, y, z, pad) {
        if (!rotated[i]) {
            return x > minX[i] - pad && x < maxX[i] + pad
                && y > minY[i] && y < maxY[i]
                && z > minZ[i] - pad && z < maxZ[i] + pad;
        }
        const o = i * 9;
        const dx = x - cx[i];
        const dy = y - cy[i];
        const dz = z - cz[i];
        const lx = rot[o] * dx + rot[o + 3] * dy + rot[o + 6] * dz;
        const ly = rot[o + 1] * dx + rot[o + 4] * dy + rot[o + 7] * dz;
        const lz = rot[o + 2] * dx + rot[o + 5] * dy + rot[o + 8] * dz;
        return Math.abs(lx) < hx[i] + pad
            && Math.abs(ly) < hy[i] + pad
            && Math.abs(lz) < hz[i] + pad;
    }

    function blocked(x, z, low, high, half) {
        const mid = (low + high) / 2;
        const x0 = x - half; const x1 = x + half;
        const z0 = z - half; const z1 = z + half;

        const scan = (list) => {
            for (let j = 0; j < list.length; j++) {
                const i = list[j];
                if (maxY[i] <= low || minY[i] >= high) continue;
                if (maxX[i] <= x0 || minX[i] >= x1) continue;
                if (maxZ[i] <= z0 || minZ[i] >= z1) continue;
                if (insideBox(i, x, low, z, half)) return true;
                if (insideBox(i, x, mid, z, half)) return true;
                if (insideBox(i, x, high, z, half)) return true;
            }
            return false;
        };

        const gx0 = Math.floor(x0 / CELL); const gx1 = Math.floor(x1 / CELL);
        const gz0 = Math.floor(z0 / CELL); const gz1 = Math.floor(z1 / CELL);
        for (let gx = gx0; gx <= gx1; gx++) {
            for (let gz = gz0; gz <= gz1; gz++) {
                const bucket = cells.get(key(gx, gz));
                if (bucket && scan(bucket)) return true;
            }
        }
        return always.length ? scan(always) : false;
    }

    return { groundAt, blocked, count: n, cells: cells.size };
}

const SEARCH = 1e6;

export function spawnPoint(parts, world) {
    const spawn = parts.find((p) => p.T === 'SpawnLocation' && Array.isArray(p.P));
    if (spawn) {
        return [spawn.P[0], spawn.P[1] + (spawn.S?.[1] ?? 1) / 2, spawn.P[2]];
    }
    if (!world) return [0, 0, 0];

    const probe = { y: 0, nx: 0, ny: 1, nz: 0 };
    const at = (x, z) => (world.groundAt(x, z, SEARCH, -SEARCH, probe) ? [x, probe.y, z] : null);

    const origin = at(0, 0);
    if (origin) return origin;

    let sx = 0;
    let sz = 0;
    let n = 0;
    let best = null;
    for (const p of parts) {
        if (!Array.isArray(p.P) || !Array.isArray(p.S)) continue;
        sx += p.P[0];
        sz += p.P[2];
        n += 1;
        const top = p.P[1] + p.S[1] / 2;
        if (!best || top > best[1]) best = [p.P[0], top, p.P[2]];
    }
    if (!n) return [0, 0, 0];

    const centre = at(sx / n, sz / n);
    if (centre) return centre;
    return best ?? [0, 0, 0];
}
