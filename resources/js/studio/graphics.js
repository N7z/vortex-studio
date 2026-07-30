const KEY = 'studio_graphics';

export const DEFAULTS = {
    shadows: true,
    shadowRes: 2048,
    scale: 1,
    studs: true,
    grid: true,
};

export const PRESETS = {
    High: { shadows: true, shadowRes: 2048, scale: 1, studs: true, grid: true },
    Medium: { shadows: true, shadowRes: 1024, scale: 0.85, studs: true, grid: true },
    Low: { shadows: false, shadowRes: 1024, scale: 0.7, studs: false, grid: true },
};

export const SCALES = [
    [1, '100%'],
    [0.85, '85%'],
    [0.7, '70%'],
    [0.5, '50%'],
];

export const SHADOW_RES = [
    [2048, 'High'],
    [1024, 'Medium'],
    [512, 'Low'],
];

const num = (v, allowed, fallback) => (allowed.some(([a]) => a === v) ? v : fallback);

export function loadGraphics() {
    let stored = {};
    try {
        stored = JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
        stored = {};
    }
    if (!stored || typeof stored !== 'object') stored = {};
    const legacyStuds = localStorage.getItem('studio_studs');
    return {
        shadows: typeof stored.shadows === 'boolean' ? stored.shadows : DEFAULTS.shadows,
        shadowRes: num(stored.shadowRes, SHADOW_RES, DEFAULTS.shadowRes),
        scale: num(stored.scale, SCALES, DEFAULTS.scale),
        studs: typeof stored.studs === 'boolean'
            ? stored.studs
            : (legacyStuds === null ? DEFAULTS.studs : legacyStuds !== '0'),
        grid: typeof stored.grid === 'boolean' ? stored.grid : DEFAULTS.grid,
    };
}

export function saveGraphics(gfx) {
    try {
        localStorage.setItem(KEY, JSON.stringify(gfx));
    } catch { /* ignore */ }
}

export function presetName(gfx) {
    for (const [name, p] of Object.entries(PRESETS)) {
        if (Object.keys(p).every((k) => p[k] === gfx[k])) return name;
    }
    return 'Custom';
}
