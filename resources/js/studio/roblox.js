export const DEFAULT_COLOR = 'a3a2a5';

const BRICK_COLORS = {
    white: 'f2f3f3',
    grey: 'a3a2a5',
    gray: 'a3a2a5',
    'medium stone grey': 'a3a2a5',
    'dark stone grey': '6d6e6c',
    'light stone grey': 'e5e4df',
    black: '1b2a34',
    'really black': '111111',
    'really red': 'ff0000',
    'bright red': 'c4281c',
    'bright blue': '0d69ac',
    'bright yellow': 'f5cd30',
    'bright green': '4b974b',
    'bright orange': 'd9a441',
    'br. yellowish orange': 'ffb84c',
    'dark green': '287f47',
    'earth green': '27462d',
    'bright violet': '6b327c',
    'bright bluish green': '008f9c',
    'medium blue': '6e99ca',
    'pastel blue': '80bbdb',
    'reddish brown': '7c503a',
    'dark orange': 'a05f35',
    brown: '7c503a',
    'brick yellow': 'd7c59a',
    nougat: 'cc8e69',
    'dark nougat': 'ad6140',
    'dark taupe': '756c62',
    'sand blue': '6c81b7',
    'sand green': 'a1c48c',
    'sand red': 'd36f4c',
    'institutional white': 'f8f8f8',
    'mid gray': 'b3b3b3',
    'mid grey': 'b3b3b3',
    'lime green': 'd7f0a3',
    'new yeller': 'ffff00',
    'really blue': '0000ff',
    'hot pink': 'ff00bf',
    'deep orange': 'ff8000',
    cyan: '02b8ff',
    magenta: 'a3238e',
    pink: 'e8bac8',
    teal: '008f9c',
    plum: '8e5252',
    burgundy: '8c5b6a',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const num = (v) => {
    if (isNum(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
};

const pick = (part, names) => {
    for (const n of names) {
        if (part[n] !== undefined && part[n] !== null) return part[n];
    }
    return undefined;
};

function vec3(v) {
    let a = v;
    if (a && !Array.isArray(a) && typeof a === 'object') {
        const x = pick(a, ['x', 'X']);
        const y = pick(a, ['y', 'Y']);
        const z = pick(a, ['z', 'Z']);
        a = [x, y, z];
    }
    if (!Array.isArray(a) || a.length !== 3) return null;
    const out = a.map(num);
    return out.every((n) => n !== null) ? out : null;
}

const byte = (n) => Math.min(Math.max(Math.round(n), 0), 255).toString(16).padStart(2, '0');

function colorOf(v) {
    if (typeof v === 'string') {
        const s = v.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
        if (/^[0-9a-fA-F]{3}$/.test(s)) return s.toLowerCase().split('').map((c) => c + c).join('');
        const named = BRICK_COLORS[v.trim().toLowerCase()];
        if (named) return named;
        return null;
    }
    const rgb = vec3(v);
    if (!rgb) return null;
    const unit = rgb.every((n) => n >= 0 && n <= 1);
    const scaled = unit ? rgb.map((n) => n * 255) : rgb;
    return scaled.map(byte).join('');
}

function typeOf(v) {
    if (typeof v !== 'string') return 'Part';
    const t = v.trim();
    if (!t || t.length > 32) return 'Part';
    return t;
}

function shapeOf(v) {
    if (typeof v !== 'string') return { shape: 'Block', changed: false };
    const s = v.trim();
    if (!s || s.toLowerCase() === 'block') return { shape: 'Block', changed: false };
    return { shape: 'Block', changed: true };
}

export function convertRoblox(doc, limit = Infinity) {
    let list = doc;
    if (list && !Array.isArray(list) && typeof list === 'object') {
        list = pick(list, ['Parts', 'parts', 'Objects', 'objects', 'Children', 'children', 'Items', 'items', 'Data', 'data']);
    }
    if (!Array.isArray(list)) throw new Error('expected a JSON array of parts');

    const parts = [];
    let dropped = 0;
    let reshaped = 0;
    let recolored = 0;
    let capped = false;

    for (const raw of list) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            dropped += 1;
            continue;
        }
        const P = vec3(pick(raw, ['P', 'Position', 'position', 'Pos']));
        const S = vec3(pick(raw, ['S', 'Size', 'size']));
        if (!P || !S) {
            dropped += 1;
            continue;
        }
        if (parts.length >= limit) {
            capped = true;
            break;
        }

        const R = vec3(pick(raw, ['R', 'Rotation', 'rotation', 'Orientation', 'orientation'])) ?? [0, 0, 0];
        const rawColor = pick(raw, ['C', 'Color', 'color', 'Colour', 'BrickColor', 'brickColor']);
        let C = rawColor === undefined ? DEFAULT_COLOR : colorOf(rawColor);
        if (C === null) {
            C = DEFAULT_COLOR;
            recolored += 1;
        }
        const tr = num(pick(raw, ['Tr', 'Transparency', 'transparency']));
        const Tr = tr === null ? 0 : Math.min(Math.max(tr, 0), 1);
        const { shape, changed } = shapeOf(pick(raw, ['Shape', 'Sh', 'shape']));
        if (changed) reshaped += 1;

        parts.push({
            T: typeOf(pick(raw, ['T', 'Type', 'type', 'ClassName', 'className'])),
            P,
            S,
            R,
            C,
            Tr,
            Shape: shape,
        });
    }

    return {
        parts, dropped, reshaped, recolored, capped, seen: list.length,
    };
}

export function importSummary(result) {
    const bits = [`Imported ${result.parts.length} part${result.parts.length === 1 ? '' : 's'}`];
    if (result.capped) bits.push('stopped at the map limit');
    if (result.dropped) bits.push(`${result.dropped} skipped with no usable Position or Size`);
    if (result.reshaped) bits.push(`${result.reshaped} non-Block shape${result.reshaped === 1 ? '' : 's'} kept as blocks`);
    if (result.recolored) bits.push(`${result.recolored} unreadable colour${result.recolored === 1 ? '' : 's'} defaulted`);

    return `${bits.join(', ')}`;
}
