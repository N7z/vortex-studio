import { LuaFactory } from 'wasmoon';
import { imagePixels } from '../image';
import {
    aspect, boxAt, grid, parseOpts, pixelAt,
} from '../imagegrid';
import preludeSrc from './prelude.lua?raw';
import archimedesSrc from './archimedes.lua?raw';
import arraySrc from './array.lua?raw';
import gapFillSrc from './gapfill.lua?raw';
import imageMakerSrc from './imagemaker.lua?raw';
import mirrorSrc from './mirror.lua?raw';
import scatterSrc from './scatter.lua?raw';
import sculptSrc from './sculpt.lua?raw';
import stairsSrc from './stairs.lua?raw';
import terrainSrc from './terrain.lua?raw';
import textSrc from './text.lua?raw';
import voxelSrc from './voxel.lua?raw';

const BUNDLED = [
    { id: 'archimedes', src: archimedesSrc },
    { id: 'array', src: arraySrc },
    { id: 'gapfill', src: gapFillSrc },
    { id: 'imagemaker', src: imageMakerSrc },
    { id: 'mirror', src: mirrorSrc },
    { id: 'scatter', src: scatterSrc },
    { id: 'sculpt', src: sculptSrc },
    { id: 'stairs', src: stairsSrc },
    { id: 'terrain', src: terrainSrc },
    { id: 'text', src: textSrc },
    { id: 'voxel', src: voxelSrc },
];

const STORE_KEY = 'studio_user_plugins';

// print() from a plugin script goes to the status line. A call that prints in a loop
// would otherwise queue thousands of them, so each run gets a small budget and the
// rest are console-only.
const MAX_PRINTS = 24;
let printSink = null;
let printsLeft = 0;
let printLabel = '';

export const onPluginPrint = (fn) => { printSink = fn; };

const openPrints = (label) => {
    printsLeft = MAX_PRINTS;
    printLabel = label ?? '';
};

// The count runs on its own, off a debounce, so anything it prints is not something
// the user asked to see.
const mutePrints = () => { printsLeft = 0; };

let factory;
const getFactory = () => (factory ??= new LuaFactory());

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

// A result flagged Replace updates the part it came from instead of being added.
// The flag is stripped here: validPart rejects any key outside PART_KEYS, so it
// must never reach the map data.
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

// The hook fires every STEP_CHUNK VM instructions; a call that burns more than
// STEP_BUDGET of them is an endless loop, and without this it freezes the tab.
const STEP_CHUNK = 1e6;
const STEP_BUDGET = 1000;

// The hook has to be installed from inside the call: wasmoon runs each one on its
// own Lua thread, and a hook belongs to the thread that set it.
const GUARD_SRC = `
do
    local steps = 0
    local function guard()
        steps = steps + 1
        if steps > ${STEP_BUDGET} then
            error('the script ran too long, check it for an endless loop', 2)
        end
    end
    local function limited(fn)
        return function(...)
            steps = 0
            debug.sethook(guard, '', ${STEP_CHUNK})
            local ok, res = pcall(fn, ...)
            debug.sethook()
            if not ok then error(res, 0) end
            return res
        end
    end
    __preview = limited(__preview)
    __click = limited(__click)
    __count = limited(__count)
end
`;

const meta = (p) => {
    if (!p || typeof p !== 'object') throw new Error('script must define a global "plugin" table');
    if (!p.name) throw new Error('plugin.name is required');
    const ui = toArray(p.ui).map((c) => ({ ...c }));

    return {
        name: String(p.name),
        icon: p.icon,
        usesFaces: p.faces === true,
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
        const luaPreview = lua.global.get('__preview');
        const luaClick = lua.global.get('__click');
        const luaCount = lua.global.get('__count');
        const luaSetImage = lua.global.get('__set_image');
        const luaSetModel = lua.global.get('__set_model');
        await lua.global.get('__set_limits')(partLimit);
        const luaSetSelection = lua.global.get('__set_selection');

        return {
            plugin: lua.global.get('plugin'),
            preview: async (part, values) =>
                toParts(await luaPreview(JSON.stringify(part), JSON.stringify(values))),
            click: async (btnId, part, values) =>
                toParts(await luaClick(btnId, JSON.stringify(part), JSON.stringify(values))),
            count: async (values) => Number(await luaCount(JSON.stringify(values))),
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
            close: () => lua.global.close(),
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
        count: async (values) => {
            mutePrints();
            return (await get()).count(values);
        },
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

// One shared engine reads every plugin's registration table at boot, so the list can
// be shown without giving each plugin its own wasm memory before it is ever opened.
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

// Lifted for an admin, who is trusted with maps of any size.
let partLimit = 50_000;

export function setPartLimit(n) {
    partLimit = Number.isFinite(n) ? n : 50_000;
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

export async function loadPlugins() {
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
