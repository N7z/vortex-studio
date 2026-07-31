const LIN = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

const toSrgb = (v) => {
    const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
    return c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055;
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const byte = (v) => clamp(Math.round(v), 0, 255);

const DEFAULTS = {
    trim: false,
    alphaCut: 128,
    nearest: false,
    brightness: 0,
    contrast: 0,
    saturation: 1,
    gamma: 1,
    colors: 0,
    dither: false,
    key: '',
    keyTol: 0.1,
    rows: 0,
};

export function parseOpts(str) {
    const out = { ...DEFAULTS };
    if (!str) return out;
    for (const pair of String(str).split(';')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq < 1) continue;
        const k = pair.slice(0, eq);
        if (!(k in DEFAULTS)) continue;
        const raw = pair.slice(eq + 1);
        const def = DEFAULTS[k];
        if (typeof def === 'boolean') out[k] = raw === 'true' || raw === '1';
        else if (typeof def === 'number') {
            const n = Number(raw);
            out[k] = Number.isFinite(n) ? n : def;
        } else out[k] = raw;
    }
    return out;
}

function bounds(pix, alphaCut) {
    pix.bounds ??= new Map();
    const hit = pix.bounds.get(alphaCut);
    if (hit) return hit;

    const { w, h, data } = pix;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            if (data[(y * w + x) * 4 + 3] >= alphaCut) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    const box = x1 < 0
        ? { x0: 0, y0: 0, x1: w, y1: h }
        : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    pix.bounds.set(alphaCut, box);
    return box;
}

export function aspect(pix, opts) {
    const b = opts.trim ? bounds(pix, opts.alphaCut) : { x0: 0, y0: 0, x1: pix.w, y1: pix.h };
    return [b.x1 - b.x0, b.y1 - b.y0];
}

function average(pix, x0, y0, x1, y1) {
    const { w, data } = pix;
    let lr = 0; let lg = 0; let lb = 0; let wa = 0; let sa = 0; let n = 0;
    for (let y = y0; y < y1; y += 1) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x += 1, i += 4) {
            const a = data[i + 3];
            const k = a / 255;
            lr += LIN[data[i]] * k;
            lg += LIN[data[i + 1]] * k;
            lb += LIN[data[i + 2]] * k;
            wa += k;
            sa += a;
            n += 1;
        }
    }
    if (n === 0) return [0, 0, 0, 0];
    if (wa <= 0) return [0, 0, 0, 0];
    return [lr / wa, lg / wa, lb / wa, sa / n];
}

function adjust(lr, lg, lb, opts) {
    let r = lr; let g = lg; let b = lb;
    if (opts.gamma !== 1 && opts.gamma > 0) {
        const e = 1 / opts.gamma;
        r = r ** e; g = g ** e; b = b ** e;
    }
    r = toSrgb(r) * 255; g = toSrgb(g) * 255; b = toSrgb(b) * 255;
    if (opts.brightness !== 0) {
        const d = opts.brightness * 255;
        r += d; g += d; b += d;
    }
    if (opts.contrast !== 0) {
        const k = 1 + clamp(opts.contrast, -1, 1);
        r = (r - 128) * k + 128; g = (g - 128) * k + 128; b = (b - 128) * k + 128;
    }
    if (opts.saturation !== 1) {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const s = clamp(opts.saturation, 0, 4);
        r = lum + (r - lum) * s; g = lum + (g - lum) * s; b = lum + (b - lum) * s;
    }
    return [byte(r), byte(g), byte(b)];
}

function keyRgb(key) {
    const s = String(key ?? '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [
        parseInt(s.slice(0, 2), 16),
        parseInt(s.slice(2, 4), 16),
        parseInt(s.slice(4, 6), 16),
    ];
}

function medianCut(cells, live, want) {
    const first = [];
    for (const i of live) first.push(i);
    let boxes = [first];

    while (boxes.length < want) {
        let best = -1; let bestScore = 0; let bestCh = 0;
        for (let bi = 0; bi < boxes.length; bi += 1) {
            const box = boxes[bi];
            if (box.length < 2) continue;
            const lo = [255, 255, 255]; const hi = [0, 0, 0];
            for (const i of box) {
                for (let c = 0; c < 3; c += 1) {
                    const v = cells[i * 4 + c];
                    if (v < lo[c]) lo[c] = v;
                    if (v > hi[c]) hi[c] = v;
                }
            }
            const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
            const ch = span[0] >= span[1] && span[0] >= span[2] ? 0 : span[1] >= span[2] ? 1 : 2;
            const score = span[ch] * box.length;
            if (score > bestScore) { bestScore = score; best = bi; bestCh = ch; }
        }
        if (best < 0) break;
        const box = boxes[best];
        box.sort((a, b) => cells[a * 4 + bestCh] - cells[b * 4 + bestCh]);
        const mid = box.length >> 1;
        boxes = [
            ...boxes.slice(0, best),
            box.slice(0, mid),
            box.slice(mid),
            ...boxes.slice(best + 1),
        ].filter((b) => b.length > 0);
    }

    return boxes.map((box) => {
        let r = 0; let g = 0; let b = 0;
        for (const i of box) {
            r += LIN[cells[i * 4]];
            g += LIN[cells[i * 4 + 1]];
            b += LIN[cells[i * 4 + 2]];
        }
        const n = box.length;
        return [
            byte(toSrgb(r / n) * 255),
            byte(toSrgb(g / n) * 255),
            byte(toSrgb(b / n) * 255),
        ];
    });
}

function nearest(palette, r, g, b) {
    let best = 0; let bestD = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
        const p = palette[i];
        const dr = r - p[0]; const dg = g - p[1]; const db = b - p[2];
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bestD) { bestD = d; best = i; }
    }
    return palette[best];
}

function quantize(cells, live, cols, rows, want, dither) {
    const palette = medianCut(cells, live, want);
    if (!palette.length) return;

    const alive = new Uint8Array(cols * rows);
    for (const i of live) alive[i] = 1;

    if (!dither) {
        for (const i of live) {
            const p = nearest(palette, cells[i * 4], cells[i * 4 + 1], cells[i * 4 + 2]);
            cells[i * 4] = p[0]; cells[i * 4 + 1] = p[1]; cells[i * 4 + 2] = p[2];
        }
        return;
    }

    const err = new Float32Array(cols * rows * 3);
    for (let y = 0; y < rows; y += 1) {
        const ltr = (y & 1) === 0;
        for (let k = 0; k < cols; k += 1) {
            const x = ltr ? k : cols - 1 - k;
            const i = y * cols + x;
            if (!alive[i]) continue;
            const r = cells[i * 4] + err[i * 3];
            const g = cells[i * 4 + 1] + err[i * 3 + 1];
            const b = cells[i * 4 + 2] + err[i * 3 + 2];
            const p = nearest(palette, r, g, b);
            cells[i * 4] = p[0]; cells[i * 4 + 1] = p[1]; cells[i * 4 + 2] = p[2];
            const er = r - p[0]; const eg = g - p[1]; const eb = b - p[2];
            const spread = (nx, ny, f) => {
                if (nx < 0 || nx >= cols || ny >= rows) return;
                const j = (ny * cols + nx) * 3;
                if (!alive[ny * cols + nx]) return;
                err[j] += er * f; err[j + 1] += eg * f; err[j + 2] += eb * f;
            };
            const step = ltr ? 1 : -1;
            spread(x + step, y, 7 / 16);
            spread(x - step, y + 1, 3 / 16);
            spread(x, y + 1, 5 / 16);
            spread(x + step, y + 1, 1 / 16);
        }
    }
}

export function grid(pix, cols, opts) {
    const b = opts.trim ? bounds(pix, opts.alphaCut) : { x0: 0, y0: 0, x1: pix.w, y1: pix.h };
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const wide = Math.max(1, Math.floor(cols));
    const tall = opts.rows > 0
        ? Math.max(1, Math.floor(opts.rows))
        : Math.max(1, Math.round(wide * bh / bw));

    const cells = new Uint8ClampedArray(wide * tall * 4);
    const key = keyRgb(opts.key);
    const tol = clamp(opts.keyTol, 0, 1) * 441.673;
    const live = [];

    for (let row = 0; row < tall; row += 1) {
        const sy0 = b.y0 + Math.floor(row * bh / tall);
        const sy1 = Math.max(sy0 + 1, b.y0 + Math.ceil((row + 1) * bh / tall));
        for (let col = 0; col < wide; col += 1) {
            const sx0 = b.x0 + Math.floor(col * bw / wide);
            const sx1 = Math.max(sx0 + 1, b.x0 + Math.ceil((col + 1) * bw / wide));

            let lr; let lg; let lb; let a;
            if (opts.nearest) {
                const cx = clamp((sx0 + sx1) >> 1, 0, pix.w - 1);
                const cy = clamp((sy0 + sy1) >> 1, 0, pix.h - 1);
                const i = (cy * pix.w + cx) * 4;
                lr = LIN[pix.data[i]]; lg = LIN[pix.data[i + 1]]; lb = LIN[pix.data[i + 2]];
                a = pix.data[i + 3];
            } else {
                [lr, lg, lb, a] = average(
                    pix,
                    clamp(sx0, 0, pix.w), clamp(sy0, 0, pix.h),
                    clamp(sx1, 0, pix.w), clamp(sy1, 0, pix.h),
                );
            }

            const [r, g, bl] = adjust(lr, lg, lb, opts);
            const i = (row * wide + col) * 4;
            cells[i] = r; cells[i + 1] = g; cells[i + 2] = bl;

            let alpha = a;
            if (key) {
                const d = Math.hypot(r - key[0], g - key[1], bl - key[2]);
                if (d <= tol) alpha = 0;
            }
            cells[i + 3] = alpha < opts.alphaCut ? 0 : Math.max(1, Math.round(alpha));
            if (cells[i + 3] > 0) live.push(row * wide + col);
        }
    }

    if (opts.colors > 0 && live.length > opts.colors) {
        quantize(cells, live, wide, tall, Math.floor(opts.colors), opts.dither);
    }

    const out = new Array(wide * tall);
    for (let i = 0; i < wide * tall; i += 1) {
        const o = i * 4;
        out[i] = cells[o + 3] === 0
            ? '00000000'
            : HEX[cells[o]] + HEX[cells[o + 1]] + HEX[cells[o + 2]] + HEX[cells[o + 3]];
    }
    return { cols: wide, rows: tall, data: out.join('') };
}

export function pixelAt(pix, x, y) {
    const px = Math.floor(x); const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= pix.w || py >= pix.h) return '';
    const i = (py * pix.w + px) * 4;
    return HEX[pix.data[i]] + HEX[pix.data[i + 1]] + HEX[pix.data[i + 2]] + HEX[pix.data[i + 3]];
}

export function boxAt(pix, x0, y0, x1, y1) {
    const ax = clamp(Math.floor(x0), 0, pix.w);
    const ay = clamp(Math.floor(y0), 0, pix.h);
    const bx = clamp(Math.ceil(x1), ax + 1, pix.w);
    const by = clamp(Math.ceil(y1), ay + 1, pix.h);
    if (ax >= pix.w || ay >= pix.h) return '';
    const [lr, lg, lb, a] = average(pix, ax, ay, bx, by);
    return HEX[byte(toSrgb(lr) * 255)]
        + HEX[byte(toSrgb(lg) * 255)]
        + HEX[byte(toSrgb(lb) * 255)]
        + HEX[byte(a)];
}
