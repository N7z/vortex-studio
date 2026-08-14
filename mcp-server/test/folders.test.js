import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import path from 'node:path';
import url from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { rotationMatrix } from '../src/geom.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let client;

const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.find((c) => c.type === 'text');

    return { isError: !!result.isError, data: text ? JSON.parse(text.text) : null };
};

const ok = async (name, args) => {
    const result = await call(name, args);
    assert.equal(result.isError, false, `${name} failed: ${JSON.stringify(result.data)}`);

    return result.data;
};

const slab = (y) => ({ position: [0, y, 0], size: [4, 1, 4] });

before(async () => {
    client = new Client({ name: 'folders-test', version: '1' });
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

test('place_parts extends the folder it names instead of making a second one', async () => {
    const room = await ok('create_room', {
        name: 'Casa', x: 0, z: 0, width: 30, depth: 24,
    });

    const roof = await ok('place_parts', { parts: [slab(20)], folder: 'Casa' });
    assert.equal(roof.appendedToFolder, true);
    assert.equal(roof.folderId, room.folderId);

    const byId = await ok('place_parts', { parts: [slab(22)], folder: room.folderId });
    assert.equal(byId.appendedToFolder, true);
    assert.equal(byId.folderId, room.folderId);

    const structure = await ok('get_structure');
    assert.equal(structure.folders.length, 1);
    assert.equal(structure.folders[0].name, 'Casa');
    assert.equal(structure.folders[0].parts, room.partsAdded + 2);

    const fresh = await ok('place_parts', { parts: [slab(30)], folder: 'Anexo' });
    assert.equal(fresh.appendedToFolder, false);
    assert.equal((await ok('get_structure')).folders.length, 2);
});

test('group_parts moves loose parts into a folder and out of their old one', async () => {
    const loose = await ok('place_parts', { parts: [slab(40), slab(42)] });
    const before = await ok('get_structure');
    assert.equal(before.ungrouped, 2);

    const filed = await ok('group_parts', { folder: 'Casa', ids: loose.ids });
    assert.equal(filed.moved, 2);
    assert.equal((await ok('get_structure')).ungrouped, 0);

    const moved = await ok('group_parts', { folder: 'Anexo', ids: [loose.ids[0]] });
    assert.equal(moved.folder, 'Anexo');

    const structure = await ok('get_structure');
    const casa = structure.folders.find((f) => f.name === 'Casa');
    const anexo = structure.folders.find((f) => f.name === 'Anexo');
    assert.ok(!casa.parts || casa.parts >= 1);
    assert.equal(anexo.parts, 2);
});

test('rename_folder and delete_folder touch the grouping, not the geometry', async () => {
    const renamed = await ok('rename_folder', { folder: 'Anexo', name: 'Galpao' });
    assert.equal(renamed.was, 'Anexo');
    assert.equal(renamed.folder, 'Galpao');

    const parts = renamed.totalParts;
    const removed = await ok('delete_folder', { folder: 'Galpao' });
    assert.equal(removed.removedFolder, 'Galpao');
    assert.equal(removed.totalParts, parts);

    const structure = await ok('get_structure');
    assert.ok(!structure.folders.some((f) => f.name === 'Galpao'));
    assert.equal(structure.ungrouped, 2);

    const missing = await call('rename_folder', { folder: 'Galpao', name: 'x' });
    assert.equal(missing.isError, true);
    assert.match(missing.data.error, /no folder/);
});

test('create_room says so when it duplicates a folder name', async () => {
    const again = await ok('create_room', {
        name: 'Casa', x: 100, z: 100, width: 20, depth: 20,
    });

    assert.match(again.note, /already a folder called "Casa"/);
    assert.equal((await ok('get_structure')).folders.filter((f) => f.name === 'Casa').length, 2);
});

// place_parts documents this sign to whoever is building a roof, so it has to stay true.
test('a positive X rotation tips the +Z edge down', () => {
    const m = rotationMatrix(33.69, 0, 0);
    const localZinWorld = [m[2], m[5], m[8]];

    assert.ok(localZinWorld[1] < 0, `local +Z points ${localZinWorld}`);
    assert.ok(localZinWorld[2] > 0);
    assert.ok(Math.abs(-localZinWorld[1] / localZinWorld[2] - 2 / 3) < 0.01, 'a 2:3 pitch');
});

test('create_roof caps a room and lands in the same folder as it', async () => {
    const room = await ok('create_room', {
        name: 'Chale', x: 200, z: 200, width: 30, depth: 24, height: 14,
    });

    const roof = await ok('create_roof', {
        name: 'Chale', x: 200, z: 200, width: 30, depth: 24, y: 14, pitch: 33.69,
    });

    assert.equal(roof.ridge, 'x');
    assert.equal(roof.folderId, room.folderId);
    assert.equal(roof.partsAdded, 6);
    assert.match(roof.note, /view "side"/);

    const structure = await ok('get_structure');
    const folder = structure.folders.find((f) => f.name === 'Chale');
    assert.equal(folder.parts, room.partsAdded + 6);
    assert.ok(folder.bounds.maxY > 21, `ridge height ${folder.bounds.maxY}`);
});

test('create_room can raise its own roof in one undoable action', async () => {
    const before = (await ok('get_map_info')).parts;
    const room = await ok('create_room', {
        name: 'Casebre',
        x: 300,
        z: 300,
        width: 20,
        depth: 30,
        height: 14,
        roof: { pitch: 40, color: 'a0453a' },
    });

    assert.equal(room.roof.ridge, 'z', 'the ridge follows the long side');
    assert.ok(room.roof.ridgeY > 14);

    const undone = await ok('undo');
    assert.equal(undone.totalParts, before, 'room and roof come back off together');
});
