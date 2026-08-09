import { LuaFactory } from 'wasmoon';
import { imagePixels } from '../image';
import {
    aspect, boxAt, grid, parseOpts, pixelAt,
} from '../imagegrid';
import preludeSrc from './prelude.lua?raw';
import archimedesSrc from './archimedes.lua?raw';
import arraySrc from './array.lua?raw';
import circleSrc from './circle.lua?raw';
import gapFillSrc from './gapfill.lua?raw';
import imageMakerSrc from './imagemaker.lua?raw';
import mirrorSrc from './mirror.lua?raw';
import paintbrushSrc from './paintbrush.lua?raw';
import scatterSrc from './scatter.lua?raw';
import modelSrc from './model.lua?raw';
import stairsSrc from './stairs.lua?raw';
import terrainSrc from './terrain.lua?raw';
import textSrc from './text.lua?raw';
import voxelSrc from './voxel.lua?raw';

const BUNDLED = [
    { id: 'archimedes', src: archimedesSrc },
    { id: 'array', src: arraySrc },
    { id: 'circle', src: circleSrc },
    { id: 'gapfill', src: gapFillSrc },
    { id: 'imagemaker', src: imageMakerSrc },
    { id: 'mirror', src: mirrorSrc },
    { id: 'paintbrush', src: paintbrushSrc },
    { id: 'scatter', src: scatterSrc },
    { id: 'model', src: modelSrc },
    { id: 'stairs', src: stairsSrc },
    { id: 'terrain', src: terrainSrc },
    { id: 'text', src: textSrc },
    { id: 'voxel', src: voxelSrc },
];

const STORE_KEY = 'studio_user_plugins';

const MAX_PRINTS = 24;
let printSink = null;
let printsLeft = 0;
let printLabel = '';

export const onPluginPrint = (fn) => { printSink = fn; };

const openPrints = (label) => {
    printsLeft = MAX_PRINTS;
    printLabel = label ?? '';
};

let factory;
const getFactory = () => (factory ??= new LuaFactory());

if (typeof globalThis.setImmediate !== 'function') {
    globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}

let progressSink = null;
export const onPluginProgress = (fn) => { progressSink = fn; };

const toArray = (t) => {
    if (t == null) return [];
    if (Array.isArray(t)) return t;
    const out = [];
    for (let i = 1; t[i] !== undefined; i++) out.push(t[i]);
    return out;
};

const vec3 = (v) => {
    const a = toArray(v);
    return [Number(a[0]), Number(a[1]), Number(a[2])];
};

export function normPart(p) {
    if (!p || typeof p !== 'object') return null;
    const { _id, ...rest } = p;
    return { ...rest, P: vec3(p.P), S: vec3(p.S), R: vec3(p.R) };
}

export function stripId(part) {
    const { _id, ...rest } = part;
    return rest;
}

const toParts = (res) => {
    if (res == null || typeof res !== 'object') return [];
    const list = res.P !== undefined ? [res] : toArray(res);
    return list.map((raw) => {
        const part = normPart(raw);
        if (!part) return null;
        const replace = part.Replace === true || part.Replace === 1;
        delete part.Replace;
        return { part, replace };
    }).filter(Boolean);
};

const PATCH_KEYS = ['T', 'C', 'Tr', 'Shape', 'Sh', 'ItemId'];

const hex6 = (v) => {
    const s = String(v ?? '').replace(/^#/, '').toLowerCase();
    return /^[0-9a-f]{6}$/.test(s) ? s : null;
};

export const toPatch = (res) => {
    if (res == null || typeof res !== 'object') return null;
    const out = {};
    for (const k of PATCH_KEYS) {
        if (res[k] === undefined || res[k] === null) continue;
        if (k === 'C') {
            const c = hex6(res[k]);
            if (c) out.C = c;
        } else if (k === 'Tr') {
            const t = Number(res[k]);
            if (Number.isFinite(t)) out.Tr = Math.min(1, Math.max(0, t));
        } else if (k === 'ItemId') {
            const n = Number(res[k]);
            if (Number.isInteger(n)) out.ItemId = n;
        } else {
            out[k] = String(res[k]).slice(0, 32);
        }
    }
    for (const k of ['P', 'S', 'R']) {
        if (res[k] === undefined || res[k] === null) continue;
        const v = vec3(res[k]);
        if (v.every(Number.isFinite)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
};

const STEP_CHUNK = 1e6;
export const STEP_BUDGET = 1000;

const GUARD_SRC = `
do
    local steps = 0
    local budget = ${STEP_BUDGET}
    local function guard()
        steps = steps + 1
        if steps > budget then
            error('the script ran too long, check it for an endless loop', 2)
        end
    end
    local function limited(fn)
        return function(...)
            steps = 0
            budget = (Limits and Limits.steps) or ${STEP_BUDGET}
            if budget > 0 then debug.sethook(guard, '', ${STEP_CHUNK}) end
            local ok, res = pcall(fn, ...)
            if budget > 0 then debug.sethook() end
            if not ok then error(res, 0) end
            return res
        end
    end
    __preview = limited(__preview)
    __click = limited(__click)
    __paint = limited(__paint)
end
`;

const meta = (p) => {
    if (!p || typeof p !== 'object') throw new Error('script must define a global "plugin" table');
    if (!p.name) throw new Error('plugin.name is required');
    const ui = toArray(p.ui).map((c) => ({ ...c }));

    return {
        name: String(p.name),
        version: p.version == null ? null : String(p.version),
        icon: p.icon,
        usesFaces: p.faces === true,
        usesBrush: p.brush === true,
        ui,
        defaults: Object.fromEntries(
            ui.filter((c) => !['button', 'image', 'model'].includes(c.type))
                .map((c) => [c.id, c.default]),
        ),
    };
};

async function startEngine(src) {
    const lua = await getFactory().createEngine();
    let pix = null;
    try {
        lua.global.set('__print', (text) => {
            const line = String(text ?? '');
            console.log(`[${printLabel || 'plugin'}] ${line}`);
            if (printsLeft <= 0) return;
            printsLeft -= 1;
            printSink?.(printLabel ? `${printLabel}: ${line}` : line);
        });
        lua.global.set('__img_px', (x, y) => (pix ? pixelAt(pix, x, y) : ''));
        lua.global.set('__img_box', (x0, y0, x1, y1) => (pix ? boxAt(pix, x0, y0, x1, y1) : ''));
        lua.global.set('__img_aspect', (o) => {
            if (!pix) return '';
            const [w, h] = aspect(pix, parseOpts(o));
            return `${w},${h}`;
        });
        lua.global.set('__img_grid', (cols, o) => {
            if (!pix) return '';
            const g = grid(pix, cols, parseOpts(o));
            return `${g.cols},${g.rows},${g.data}`;
        });
        await lua.doString(preludeSrc);
        await lua.doString(src);
        await lua.doString(GUARD_SRC);
        lua.global.set('__progress', (p) => progressSink?.(p));
        const luaPreview = lua.global.get('__preview');
        const luaResetProgress = lua.global.get('__reset_progress');
        const luaSetImage = lua.global.get('__set_image');
        const luaSetModel = lua.global.get('__set_model');
        const luaSetLimits = lua.global.get('__set_limits');
        const applyLimits = () => luaSetLimits(partLimit, voxelLimit, stepBudget);
        await applyLimits();
        liveLimits.add(applyLimits);
        const luaSetSelection = lua.global.get('__set_selection');
        const luaPaint = lua.global.get('__paint');
        const luaSetBrush = lua.global.get('__set_brush');

        return {
            plugin: lua.global.get('plugin'),
            paint: async (part, values) =>
                toPatch(await luaPaint(JSON.stringify(part), JSON.stringify(values))),
            setBrush: async (info) => {
                await luaSetBrush(info ? JSON.stringify(info) : '');
            },
            preview: async (part, values) =>
                toParts(await luaPreview(JSON.stringify(part), JSON.stringify(values))),
            click: async (btnId, part, values) => {
                await luaResetProgress();
                lua.global.set('__click_id', btnId);
                lua.global.set('__click_part', JSON.stringify(part));
                lua.global.set('__click_values', JSON.stringify(values));
                return toParts(await lua.doString(
                    'return __click(__click_id, __click_part, __click_values)',
                ));
            },
                setImage: async (img) => {
                pix = imagePixels(img?.id);
                await luaSetImage(pix?.w ?? 0, pix?.h ?? 0);
            },
            setSelection: async (info) => {
                await luaSetSelection(info ? JSON.stringify(info) : '');
            },
            setModel: async (model) => {
                await luaSetModel(
                    model?.w ?? 0, model?.h ?? 0, model?.d ?? 0, model?.count ?? 0, model?.data ?? '',
                );
            },
            close: () => {
                liveLimits.delete(applyLimits);
                lua.global.close();
            },
        };
    } catch (e) {
        lua.global.close();
        throw e;
    }
}

function wrap(id, builtin, info, open) {
    let engine = null;
    const get = () => (engine ??= open());

    return {
        id,
        builtin,
        ...info,
        preview: async (part, values) => {
            openPrints(info.name);
            return (await get()).preview(part, values);
        },
        click: async (btnId, part, values) => {
            openPrints(info.name);
            return (await get()).click(btnId, part, values);
        },
        paint: async (part, values) => (await get()).paint(part, values),
        setBrush: async (info) => (await get()).setBrush(info),
        setImage: async (img) => (await get()).setImage(img),
        setSelection: async (sel) => (await get()).setSelection(sel),
        setModel: async (model) => (await get()).setModel(model),
        close: () => {
            const pending = engine;
            engine = null;
            pending?.then((e) => e.close(), () => {});
        },
    };
}

export async function compilePlugin(id, src, builtin = false) {
    const engine = await startEngine(src);
    try {
        return wrap(id, builtin, meta(engine.plugin), () => Promise.resolve(engine));
    } catch (e) {
        engine.close();
        throw e;
    }
}

let metaEngine;
const readMeta = async (src) => {
    metaEngine ??= (async () => {
        const lua = await getFactory().createEngine();
        await lua.doString(preludeSrc);

        return lua;
    })();
    const lua = await metaEngine;
    await lua.doString('plugin = nil');
    await lua.doString(src);

    return meta(lua.global.get('plugin'));
};

const lazyPlugin = async (id, src, builtin = false) =>
    wrap(id, builtin, await readMeta(src), () => startEngine(src));

export function userPlugins() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) ?? [];
    } catch {
        return [];
    }
}

let partLimit = 50_000;
let voxelLimit = 400_000;
let stepBudget = STEP_BUDGET;
const liveLimits = new Set();

function pushLimits() {
    for (const apply of liveLimits) {
        try {
            Promise.resolve(apply()).catch(() => {});
        } catch {
            liveLimits.delete(apply);
        }
    }
}

export function setPartLimit(n) {
    partLimit = Number.isFinite(n) ? n : 50_000;
    pushLimits();
}

export function setVoxelLimit(n) {
    voxelLimit = Number.isFinite(n) ? n : 400_000;
    pushLimits();
}

export function setStepBudget(n) {
    stepBudget = Number.isFinite(n) && n > 0 ? n : 0;
    pushLimits();
}

export function isBuiltin(id) {
    return BUNDLED.some((b) => b.id === id);
}

export function builtinSource(id) {
    return BUNDLED.find((b) => b.id === id)?.src ?? null;
}

export function userPluginSource(id) {
    return userPlugins().find((p) => p.id === id)?.src ?? builtinSource(id);
}

export function resetBuiltin(id) {
    deleteUserPlugin(id);
    return builtinSource(id);
}

export function saveUserPlugin(id, src) {
    const list = userPlugins().filter((p) => p.id !== id);
    list.push({ id, src });
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
}

export function deleteUserPlugin(id) {
    localStorage.setItem(STORE_KEY, JSON.stringify(userPlugins().filter((p) => p.id !== id)));
}

function renameSculpt() {
    const list = userPlugins();
    const old = list.find((p) => p.id === 'sculpt');
    if (!old || list.some((p) => p.id === 'model')) return;
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(
            list.filter((p) => p.id !== 'sculpt').concat({ id: 'model', src: old.src }),
        ));
    } catch { /* the builtin still loads */ }
}

export async function loadPlugins() {
    renameSculpt();
    const out = [];
    const stored = userPlugins();
    for (const { id, src } of BUNDLED) {
        const override = stored.find((s) => s.id === id);
        try {
            out.push(await lazyPlugin(id, override?.src ?? src, true));
        } catch (e) {
            console.error(`plugin ${id} failed to load`, e);
            if (override) {
                try {
                    out.push(await lazyPlugin(id, src, true));
                } catch (e2) {
                    console.error(`builtin ${id} failed to load`, e2);
                }
            }
        }
    }
    for (const { id, src } of stored) {
        if (isBuiltin(id)) continue;
        try {
            out.push(await lazyPlugin(id, src));
        } catch (e) {
            console.error(`plugin ${id} failed to load`, e);
        }
    }
    return out;
}
