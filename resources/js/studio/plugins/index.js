import { LuaFactory } from 'wasmoon';
import preludeSrc from './prelude.lua?raw';
import archimedesSrc from './archimedes.lua?raw';
import arraySrc from './array.lua?raw';
import gapFillSrc from './gapfill.lua?raw';
import imageMakerSrc from './imagemaker.lua?raw';
import mirrorSrc from './mirror.lua?raw';
import scatterSrc from './scatter.lua?raw';
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
    { id: 'stairs', src: stairsSrc },
    { id: 'terrain', src: terrainSrc },
    { id: 'text', src: textSrc },
    { id: 'voxel', src: voxelSrc },
];

const STORE_KEY = 'studio_user_plugins';

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

export async function compilePlugin(id, src, builtin = false) {
    const lua = await getFactory().createEngine();
    try {
        await lua.doString(preludeSrc);
        await lua.doString(src);
        const p = lua.global.get('plugin');
        if (!p || typeof p !== 'object') throw new Error('script must define a global "plugin" table');
        if (!p.name) throw new Error('plugin.name is required');
        const luaPreview = lua.global.get('__preview');
        const luaClick = lua.global.get('__click');
        const luaSetImage = lua.global.get('__set_image');
        const luaSetModel = lua.global.get('__set_model');
        const luaSetSelection = lua.global.get('__set_selection');
        const ui = toArray(p.ui).map((c) => ({ ...c }));
        return {
            id,
            builtin,
            name: String(p.name),
            icon: p.icon,
            ui,
            defaults: Object.fromEntries(
                ui.filter((c) => !['button', 'image', 'model'].includes(c.type))
                    .map((c) => [c.id, c.default]),
            ),
            preview: async (part, values) =>
                toParts(await luaPreview(JSON.stringify(part), JSON.stringify(values))),
            click: async (btnId, part, values) =>
                toParts(await luaClick(btnId, JSON.stringify(part), JSON.stringify(values))),
            setImage: async (img) => {
                await luaSetImage(img?.w ?? 0, img?.h ?? 0, img?.data ?? '');
            },
            setSelection: async (info) => {
                await luaSetSelection(info ? JSON.stringify(info) : '');
            },
            setModel: async (grid) => {
                await luaSetModel(
                    grid?.w ?? 0, grid?.h ?? 0, grid?.d ?? 0, grid?.count ?? 0, grid?.data ?? '',
                );
            },
            close: () => lua.global.close(),
        };
    } catch (e) {
        lua.global.close();
        throw e;
    }
}

export function userPlugins() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) ?? [];
    } catch {
        return [];
    }
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
            out.push(await compilePlugin(id, override?.src ?? src, true));
        } catch (e) {
            console.error(`plugin ${id} failed to load`, e);
            if (override) {
                try {
                    out.push(await compilePlugin(id, src, true));
                } catch (e2) {
                    console.error(`builtin ${id} failed to load`, e2);
                }
            }
        }
    }
    for (const { id, src } of stored) {
        if (isBuiltin(id)) continue;
        try {
            out.push(await compilePlugin(id, src));
        } catch (e) {
            console.error(`plugin ${id} failed to load`, e);
        }
    }
    return out;
}
