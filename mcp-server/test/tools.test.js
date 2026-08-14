import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import path from 'node:path';
import url from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let client;

const call = async (name, args = {}) => {
    let result;
    try {
        result = await client.callTool({ name, arguments: args });
    } catch (e) {
        // Schema violations are rejected by the protocol layer before the handler runs.
        return { isError: true, data: { error: e.message }, image: null };
    }
    const text = result.content.find((c) => c.type === 'text');
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text.text);
        } catch {
            data = { error: text.text };
        }
    }

    return {
        isError: !!result.isError,
        data,
        image: result.content.find((c) => c.type === 'image') ?? null,
    };
};

const ok = async (name, args) => {
    const result = await call(name, args);
    assert.equal(result.isError, false, `${name} failed: ${JSON.stringify(result.data)}`);

    return result.data;
};

before(async () => {
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, 'src', 'index.js')],
        cwd: root,
        env: { ...process.env, STUDIO_EMAIL: '', STUDIO_PASSWORD: '' },
    }));
});

after(async () => {
    await client?.close();
});

test('every tool advertises a description and an object schema', async () => {
    const { tools } = await client.listTools();

    assert.ok(tools.length >= 30);
    for (const tool of tools) {
        assert.ok(tool.description?.length > 40, `${tool.name} has a thin description`);
        assert.equal(tool.inputSchema.type, 'object', `${tool.name} has no object schema`);
    }

    const names = tools.map((t) => t.name);
    for (const required of [
        'get_map_info', 'get_map_constraints', 'get_available_assets', 'create_room',
        'connect_rooms', 'scatter_props', 'validate_map', 'analyze_walkability',
        'render_map_preview', 'undo',
    ]) {
        assert.ok(names.includes(required), `missing ${required}`);
    }
});

test('the constraints come from the real movement code', async () => {
    const data = await ok('get_map_constraints');

    assert.equal(data.character.bodyHeight, 5);
    assert.equal(data.character.stepHeight, 2);
    assert.equal(data.character.maxJumpHeight, 6.37);
    assert.equal(data.limits.maxParts, 60000);
});

test('the asset catalogue describes props well enough to choose between them', async () => {
    const data = await ok('get_available_assets');

    assert.deepEqual(Object.keys(data.materials).sort(), [
        'Grass', 'Ice', 'Metal', 'Paint', 'Plastic', 'Wood',
    ]);
    assert.ok(data.props.length > 10);

    const torch = data.props.find((p) => p.id === 'torch');
    assert.equal(torch.category, 'lighting');
    assert.equal(torch.decorative, true);
    assert.equal(torch.collides, false);
    assert.ok(torch.purpose.length > 20);

    const filtered = await ok('get_available_assets', { category: 'furniture' });
    assert.ok(filtered.props.every((p) => p.category === 'furniture'));
});

test('a room can be built, inspected, rendered and undone through the protocol', async () => {
    const room = await ok('create_room', {
        name: 'Entrance Hall',
        x: 0,
        z: 0,
        width: 60,
        depth: 40,
        height: 16,
        palette: 'dungeon',
        doorways: [{ side: 'east', width: 10 }],
    });

    assert.ok(room.partsAdded > 4);
    assert.equal(room.room, 'Entrance Hall');
    assert.equal(room.mode, 'offline');

    const info = await ok('get_map_info');
    assert.equal(info.parts, room.totalParts);
    assert.equal(room.liveRoom, null);
    assert.equal(info.folders[0].name, 'Entrance Hall');

    const structure = await ok('get_structure');
    assert.equal(structure.folders.length, 1);
    assert.ok(structure.folders[0].bounds.maxX >= 60);

    const shot = await call('render_map_preview', { view: 'top', width: 240, height: 240 });
    assert.equal(shot.isError, false);
    assert.equal(shot.image.mimeType, 'image/png');
    assert.ok(shot.image.data.length > 500);
    assert.equal(shot.data.view, 'top');

    const undone = await ok('undo');
    assert.deepEqual(undone.undone, ['create room Entrance Hall']);
    assert.equal(undone.totalParts, 0);

    await ok('redo');
    assert.equal((await ok('get_map_info')).parts, room.totalParts);
});

test('bad input is refused with a message that says how to fix it', async () => {
    const tooLow = await call('create_room', {
        name: 'Crawlspace', x: 200, z: 0, width: 40, depth: 40, height: 4,
    });
    assert.equal(tooLow.isError, true);
    assert.match(tooLow.data.error, /too low/);

    const noInside = await call('create_room', {
        name: 'Solid', x: 300, z: 0, width: 3, depth: 3, height: 14,
    });
    assert.equal(noInside.isError, true);
    assert.match(noInside.data.error, /no inside/);

    const badProp = await call('place_prop', {
        prop: 'spaceship', x: 0, y: 0, z: 0,
    });
    assert.equal(badProp.isError, true);

    const badColor = await call('fill_region', {
        x: 0, y: 0, z: 0, width: 4, height: 4, depth: 4, color: 'nothex',
    });
    assert.equal(badColor.isError, true);
});

test('two rooms can be connected and the walls between them are opened', async () => {
    await ok('create_room', {
        name: 'Library', x: 0, z: 200, width: 40, depth: 40, height: 16, palette: 'dungeon',
    });
    await ok('create_room', {
        name: 'Vault', x: 120, z: 200, width: 40, depth: 40, height: 16, palette: 'dungeon',
    });

    const joined = await ok('connect_rooms', { from: 'Library', to: 'Vault', width: 10 });
    assert.ok(joined.wallsCut > 0, 'no walls were opened');
    assert.ok(joined.corridorParts > 0);

    const walk = await ok('analyze_walkability', { cell: 4 });
    assert.ok(walk.islands.length >= 1);
});

test('validation reports a missing spawn and clears once one is placed', async () => {
    const before = await ok('validate_map', { walkability: false });
    assert.equal(before.ok, false);
    assert.ok(before.issues.some((i) => i.code === 'no_spawn'));

    await ok('place_parts', {
        parts: [{
            type: 'SpawnLocation',
            position: [20, 0.5, 20],
            size: [8, 1, 8],
            color: '4db84b',
        }],
        label: 'spawn',
    });

    const after = await ok('validate_map', { walkability: false });
    assert.ok(!after.issues.some((i) => i.code === 'no_spawn'));
});

test('scattering fills a room and density notices it', async () => {
    const scattered = await ok('scatter_props', {
        x: 4,
        y: 0,
        z: 4,
        width: 50,
        depth: 30,
        props: ['crate', 'barrel', 'rubble'],
        count: 12,
        seed: 7,
    });

    assert.ok(scattered.placed > 3);
    assert.equal(scattered.positions.length, scattered.placed);

    const dense = await ok('analyze_density', { window: 40 });
    assert.ok(dense.tiles > 0);
});

test('painting a region changes only what it should', async () => {
    const painted = await ok('paint_region', {
        x: 0, y: 0, z: 0, width: 60, depth: 40, height: 40, material: 'Wood',
    });
    assert.ok(painted.painted > 0);
    assert.equal(painted.fields.M, 'Wood');

    const wood = await ok('find_parts', { material: 'Wood', limit: 500 });
    assert.ok(wood.found >= painted.painted);

    const nothing = await call('paint_region', {
        x: 5000, y: 0, z: 5000, width: 10, depth: 10, height: 10, material: 'Ice',
    });
    assert.equal(nothing.isError, true);
    assert.match(nothing.data.error, /no parts/);
});

test('tools that need the Studio explain what is missing instead of hanging', async () => {
    const result = await call('list_maps');

    assert.equal(result.isError, true);
    assert.match(result.data.error, /STUDIO_EMAIL|cannot reach/);
});

test('the session reports offline mode when no room is attached', async () => {
    const data = await ok('get_session');

    assert.equal(data.mode, 'offline');
    assert.equal(data.room, null);
    assert.equal(data.canEdit, true);
});
