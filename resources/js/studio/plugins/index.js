import { LuaFactory } from 'wasmoon';
import preludeSrc from './prelude.lua?raw';
import archimedesSrc from './archimedes.lua?raw';

const SOURCES = [
    { id: 'archimedes', src: archimedesSrc },
];

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

export async function loadPlugins() {
    const factory = new LuaFactory();
    const plugins = [];
    for (const { id, src } of SOURCES) {
        try {
            const lua = await factory.createEngine();
            await lua.doString(preludeSrc);
            await lua.doString(src);
            const p = lua.global.get('plugin');
            const luaPreview = lua.global.get('__preview');
            const luaClick = lua.global.get('__click');
            const ui = toArray(p.ui).map((c) => ({ ...c }));
            plugins.push({
                id,
                name: String(p.name ?? id),
                icon: p.icon,
                ui,
                defaults: Object.fromEntries(
                    ui.filter((c) => c.type !== 'button').map((c) => [c.id, c.default]),
                ),
                preview: async (part, values) =>
                    normPart(await luaPreview(JSON.stringify(part), JSON.stringify(values))),
                click: async (btnId, part, values) =>
                    normPart(await luaClick(btnId, JSON.stringify(part), JSON.stringify(values))),
            });
        } catch (e) {
            console.error(`plugin ${id} failed to load`, e);
        }
    }
    return plugins;
}
