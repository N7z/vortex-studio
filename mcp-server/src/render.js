import { encodePng } from './png.js';
import {
    boundsOf, partBounds, regionBounds, rotationMatrix, round,
} from './geom.js';

export const VIEWS = {
    iso: { eye: [1, 0.85, 1], up: [0, 1, 0], label: 'isometric from +X +Z' },
    iso_back: { eye: [-1, 0.85, -1], up: [0, 1, 0], label: 'isometric from -X -Z' },
    top: {
        eye: [0, 1, 0.0001],
        up: [0, 1, 0],
        label: 'straight down, like a floor plan; flattens Y, so heights and slopes are invisible',
    },
    front: {
        eye: [0, 0.15, 1],
        up: [0, 1, 0],
        label: 'from +Z looking along -Z; flattens Z, so anything that varies along Z (a roof pitched '
            + 'across Z, a ramp running along Z) reads as flat. Use side for that',
    },
    side: {
        eye: [1, 0.15, 0],
        up: [0, 1, 0],
        label: 'from +X looking along -X; flattens X, so anything that varies along X reads as flat. '
            + 'Use front for that',
    },
};

const SUN = normalise([0.55, 0.8, 0.35]);
const AMBIENT = 0.42;
const SKY = [26, 30, 38];
const GROUND_TINT = [16, 18, 22];

function normalise(v) {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;

    return [v[0] / len, v[1] / len, v[2] / len];
}

const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function parseColor(c) {
    const hex = String(c ?? 'a3a2a5').replace(/^#/, '').padStart(6, '0').slice(-6);
    const n = Number.parseInt(hex, 16);

    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const MATERIAL_LOOK = {
    Plastic: { gain: 1, spec: 0.1 },
    Wood: { gain: 0.95, spec: 0.04 },
    Metal: { gain: 0.9, spec: 0.5 },
    Grass: { gain: 0.92, spec: 0.02 },
    Ice: { gain: 1.05, spec: 0.7 },
    Paint: { gain: 1.02, spec: 0.25 },
};

const CORNERS = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

const FACES = [
    { idx: [4, 5, 6, 7], n: [0, 0, 1] },
    { idx: [1, 0, 3, 2], n: [0, 0, -1] },
    { idx: [3, 2, 6, 7], n: [0, 1, 0] },
    { idx: [0, 1, 5, 4], n: [0, -1, 0] },
    { idx: [5, 1, 2, 6], n: [1, 0, 0] },
    { idx: [0, 4, 7, 3], n: [-1, 0, 0] },
];

function cameraBasis(dir, up) {
    const forward = normalise([-dir[0], -dir[1], -dir[2]]);
    let right = cross(forward, up);
    if (Math.hypot(...right) < 1e-6) right = cross(forward, [0, 0, 1]);
    right = normalise(right);
    const trueUp = normalise(cross(right, forward));

    return { forward, right, up: trueUp };
}

export function renderMap(parts, options = {}) {
    const width = Math.max(64, Math.min(options.width ?? 800, 1600));
    const height = Math.max(64, Math.min(options.height ?? 600, 1600));
    const ss = options.antialias === false ? 1 : 2;
    const W = width * ss;
    const H = height * ss;

    const viewName = options.view ?? 'iso';
    const preset = VIEWS[viewName];
    if (!preset && !options.eye) throw new Error(`unknown view "${viewName}"`);
    const dir = normalise(options.eye ?? preset.eye);
    const basis = cameraBasis(dir, preset?.up ?? [0, 1, 0]);

    const focusRegion = options.region ? regionBounds(options.region) : null;
    // A Truss is an open lattice in the editor, so drawing it solid would mislead
    // anyone inspecting the picture.
    const drawable = parts
        .filter((p) => (p.Tr ?? 0) < 0.95)
        .map((p) => (p.T === 'Truss' ? { ...p, Tr: Math.max(p.Tr ?? 0, 0.55) } : p));
    const visible = focusRegion
        ? drawable.filter((p) => {
            const b = partBounds(p);

            return b.minX < focusRegion.maxX && b.maxX > focusRegion.minX
                && b.minZ < focusRegion.maxZ && b.maxZ > focusRegion.minZ;
        })
        : drawable;

    if (!visible.length) return null;

    const framed = options.fit === 'all'
        ? visible
        : (visible.filter((p) => !p.Bp).length ? visible.filter((p) => !p.Bp) : visible);
    const bounds = focusRegion ?? boundsOf(framed);
    const centre = [
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
    ];

    const toView = (p) => {
        const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];

        return [dot(d, basis.right), dot(d, basis.up), dot(d, basis.forward)];
    };

    let spanX = 0;
    let spanY = 0;
    for (const corner of CORNERS) {
        const v = toView([
            corner[0] < 0 ? bounds.minX : bounds.maxX,
            corner[1] < 0 ? bounds.minY : bounds.maxY,
            corner[2] < 0 ? bounds.minZ : bounds.maxZ,
        ]);
        spanX = Math.max(spanX, Math.abs(v[0]));
        spanY = Math.max(spanY, Math.abs(v[1]));
    }

    const margin = options.margin ?? 1.06;
    const scale = Math.min(W / (spanX * 2 * margin || 1), H / (spanY * 2 * margin || 1));

    const project = (p) => {
        const v = toView(p);

        return [W / 2 + v[0] * scale, H / 2 - v[1] * scale, v[2]];
    };

    const color = new Float32Array(W * H * 3);
    const depth = new Float32Array(W * H).fill(Infinity);
    for (let i = 0; i < W * H; i++) {
        const t = i / (W * H);
        color[i * 3] = SKY[0] + (GROUND_TINT[0] - SKY[0]) * t;
        color[i * 3 + 1] = SKY[1] + (GROUND_TINT[1] - SKY[1]) * t;
        color[i * 3 + 2] = SKY[2] + (GROUND_TINT[2] - SKY[2]) * t;
    }

    const highlight = options.highlight ? new Set(options.highlight) : null;
    const opaque = [];
    const clear = [];
    for (const p of visible) (p.Tr ? clear : opaque).push(p);
    clear.sort((a, b) => toView(b.P)[2] - toView(a.P)[2]);

    let bias = 0;

    const drawPart = (part, blend) => {
        bias += 1e-4;
        const [sx, sy, sz] = part.S;
        const [rx, ry, rz] = part.R ?? [0, 0, 0];
        const m = rx || ry || rz ? rotationMatrix(rx, ry, rz) : null;
        const base = parseColor(part.C);
        const look = MATERIAL_LOOK[part.M] ?? MATERIAL_LOOK.Plastic;
        const lit = highlight?.has(part._id);
        const alpha = blend ? 1 - (part.Tr ?? 0) : 1;

        const world = CORNERS.map(([cx, cy, cz]) => {
            const local = [cx * sx / 2, cy * sy / 2, cz * sz / 2];
            const v = m
                ? [
                    m[0] * local[0] + m[1] * local[1] + m[2] * local[2],
                    m[3] * local[0] + m[4] * local[1] + m[5] * local[2],
                    m[6] * local[0] + m[7] * local[1] + m[8] * local[2],
                ]
                : local;

            return [part.P[0] + v[0], part.P[1] + v[1], part.P[2] + v[2]];
        });
        const screen = world.map(project);

        for (const face of FACES) {
            let n = face.n;
            if (m) {
                n = normalise([
                    m[0] * n[0] + m[1] * n[1] + m[2] * n[2],
                    m[3] * n[0] + m[4] * n[1] + m[5] * n[2],
                    m[6] * n[0] + m[7] * n[1] + m[8] * n[2],
                ]);
            }
            if (dot(n, dir) <= 0.001) continue;

            const lambert = Math.max(0, dot(n, SUN));
            const spec = look.spec * (lambert ** 8);
            let shade = (AMBIENT + (1 - AMBIENT) * lambert) * look.gain + spec;
            if (lit) shade *= 1.35;

            const rgb = lit
                ? [Math.min(255, base[0] * 0.4 + 255 * 0.6), base[1] * 0.4, base[2] * 0.4]
                : base;

            const quad = face.idx.map((i) => screen[i]);
            triangle(quad[0], quad[1], quad[2], rgb, shade, alpha);
            triangle(quad[0], quad[2], quad[3], rgb, shade, alpha);
        }
    };

    function triangle(a, b, c, rgb, shade, alpha) {
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        if (minX > maxX || minY > maxY) return;

        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(area) < 1e-9) return;

        const r = Math.min(255, rgb[0] * shade);
        const g = Math.min(255, rgb[1] * shade);
        const bl = Math.min(255, rgb[2] * shade);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5;
                const py = y + 0.5;
                const w0 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
                const w1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area;
                if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;

                const z = a[2] + (b[2] - a[2]) * w1 + (c[2] - a[2]) * w0 - bias;
                const i = y * W + x;
                if (z >= depth[i]) continue;

                if (alpha >= 1) {
                    depth[i] = z;
                    color[i * 3] = r;
                    color[i * 3 + 1] = g;
                    color[i * 3 + 2] = bl;
                } else {
                    color[i * 3] += (r - color[i * 3]) * alpha;
                    color[i * 3 + 1] += (g - color[i * 3 + 1]) * alpha;
                    color[i * 3 + 2] += (bl - color[i * 3 + 2]) * alpha;
                }
            }
        }
    }

    for (const p of opaque) drawPart(p, false);
    for (const p of clear) drawPart(p, true);

    const out = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            for (let dy = 0; dy < ss; dy++) {
                for (let dx = 0; dx < ss; dx++) {
                    const i = ((y * ss + dy) * W + (x * ss + dx)) * 3;
                    r += color[i];
                    g += color[i + 1];
                    b += color[i + 2];
                }
            }
            const n = ss * ss;
            const o = (y * width + x) * 3;
            out[o] = Math.max(0, Math.min(255, Math.round(r / n)));
            out[o + 1] = Math.max(0, Math.min(255, Math.round(g / n)));
            out[o + 2] = Math.max(0, Math.min(255, Math.round(b / n)));
        }
    }

    return {
        png: encodePng(width, height, out),
        width,
        height,
        view: viewName,
        described: preset?.label ?? 'custom camera',
        drew: visible.length,
        bounds: {
            minX: round(bounds.minX),
            maxX: round(bounds.maxX),
            minY: round(bounds.minY),
            maxY: round(bounds.maxY),
            minZ: round(bounds.minZ),
            maxZ: round(bounds.maxZ),
        },
        unitsPerPixel: round((spanX * 2 * margin) / width, 4),
    };
}
