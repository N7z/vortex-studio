import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMap } from '../src/render.js';
import { encodePng } from '../src/png.js';
import { buildRoom } from '../src/build.js';

const scene = () => buildRoom({
    x: 0, z: 0, width: 60, depth: 40, height: 16, palette: 'dungeon',
}).map((p, i) => ({ _id: `p${i}`, ...p }));

const readPng = (buf) => {
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');

    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], type: buf[25] };
};

test('a render produces a real PNG at the size asked for', () => {
    const shot = renderMap(scene(), { view: 'iso', width: 320, height: 240 });
    const head = readPng(shot.png);

    assert.equal(head.width, 320);
    assert.equal(head.height, 240);
    assert.equal(head.depth, 8);
    assert.equal(head.type, 2);
    assert.equal(shot.drew, scene().length);
});

test('every named view renders', () => {
    for (const view of ['iso', 'iso_back', 'top', 'front', 'side']) {
        const shot = renderMap(scene(), { view, width: 200, height: 200 });
        assert.ok(shot.png.length > 100, `${view} produced nothing`);
        assert.equal(shot.view, view);
    }
});

test('an unknown view is refused', () => {
    assert.throws(() => renderMap(scene(), { view: 'sideways' }), /unknown view/);
});

test('rendering is deterministic', () => {
    const a = renderMap(scene(), { view: 'iso', width: 200, height: 150 });
    const b = renderMap(scene(), { view: 'iso', width: 200, height: 150 });

    assert.ok(a.png.equals(b.png));
});

test('a region limits what is drawn and reframes the camera', () => {
    const parts = [
        ...scene(),
        { _id: 'far', T: 'Part', P: [900, 5, 900], S: [10, 10, 10], R: [0, 0, 0], C: 'ff0000' },
    ];
    const whole = renderMap(parts, { view: 'top', width: 200, height: 200 });
    const near = renderMap(parts, {
        view: 'top',
        width: 200,
        height: 200,
        region: {
            x: 0, y: 0, z: 0, width: 60, height: 40, depth: 40,
        },
    });

    assert.equal(whole.drew, parts.length);
    assert.equal(near.drew, parts.length - 1);
    assert.ok(near.bounds.maxX <= 60);
});

test('framing ignores the baseplate unless asked not to', () => {
    const parts = [
        ...scene(),
        {
            _id: 'base', T: 'Part', P: [0, -2, 0], S: [800, 4, 800], R: [0, 0, 0], C: '444444', Bp: true,
        },
    ];
    const content = renderMap(parts, { view: 'top', width: 200, height: 200, fit: 'content' });
    const all = renderMap(parts, { view: 'top', width: 200, height: 200, fit: 'all' });

    assert.ok(content.unitsPerPixel < all.unitsPerPixel);
    assert.equal(content.drew, all.drew);
});

test('an empty map renders nothing rather than crashing', () => {
    assert.equal(renderMap([], { view: 'iso' }), null);
});

test('a fully transparent part is skipped', () => {
    const solid = renderMap(scene(), { view: 'iso', width: 160, height: 120 });
    const ghosted = renderMap(
        [...scene(), {
            _id: 'ghost', T: 'Part', P: [30, 8, 20], S: [20, 20, 20], R: [0, 0, 0], C: 'ff0000', Tr: 1,
        }],
        { view: 'iso', width: 160, height: 120 },
    );

    assert.ok(solid.png.equals(ghosted.png));
});

test('the PNG encoder round trips a known pixel pattern', () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const png = encodePng(2, 2, rgb);

    assert.equal(png.readUInt32BE(16), 2);
    assert.equal(png.readUInt32BE(20), 2);
    assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});
