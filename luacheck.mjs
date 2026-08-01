import { LuaFactory } from 'wasmoon';
import fs from 'fs';
const dir = 'resources/js/studio/plugins';
const prelude = fs.readFileSync(`${dir}/prelude.lua`, 'utf8');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.lua') && n !== 'prelude.lua')) {
    const lua = await new LuaFactory().createEngine();
    try {
        await lua.doString(prelude);
        await lua.doString(fs.readFileSync(`${dir}/${f}`, 'utf8'));
        const p = lua.global.get('plugin');
        console.log(f.padEnd(16), 'ok', p.name, 'v' + p.version);
    } catch (e) { console.log(f.padEnd(16), 'FAIL', e.message); }
    lua.global.close();
}
