import * as THREE from 'three';

export const MAX_RES = 160;

const hex = (n) => n.toString(16).padStart(2, '0');
// Three digits, because a coordinate is not a byte: an admin may voxelise past 255
// on an axis, and a 2-digit overflow used to shift every field after it.
const MAX_DIM = 4096;
const chex = (n) => n.toString(16).padStart(3, '0');

async function parseGltf(buffer) {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    return new Promise((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
    });
}

async function parseObj(text) {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    return new OBJLoader().parse(text);
}

export async function loadModel(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'glb' || ext === 'gltf') return parseGltf(await file.arrayBuffer());
    if (ext === 'obj') return parseObj(await file.text());
    throw new Error('use a .glb, .gltf or .obj file');
}

function textureSampler(map) {
    const img = map?.image;
    if (!img || !img.width) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(img.width, 512);
    canvas.height = Math.min(img.height, 512);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    try {
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
        return (u, v) => {
            const x = Math.min(Math.max(Math.floor(u * canvas.width), 0), canvas.width - 1);
            const y = Math.min(Math.max(Math.floor((1 - v) * canvas.height), 0), canvas.height - 1);
            const i = (y * canvas.width + x) * 4;
            return data[i + 3] < 128 ? null : [data[i], data[i + 1], data[i + 2]];
        };
    } catch {
        return null;
    }
}

function collect(object) {
    object.updateMatrixWorld(true);
    const meshes = [];
    object.traverse((o) => {
        if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
    });
    return meshes;
}

function materialOf(mesh) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!m) return { rgb: [170, 170, 170], sample: null };
    const c = m.color ? m.color.clone().convertLinearToSRGB() : null;
    return {
        rgb: c ? [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)] : [170, 170, 170],
        sample: textureSampler(m.map),
    };
}

export function voxelize(object, res, maxRes = MAX_RES) {
    const size = Math.min(Math.max(Math.floor(res) || 32, 4), maxRes, MAX_DIM);
    const meshes = collect(object);
    if (!meshes.length) throw new Error('this file has no meshes');

    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    const span = box.getSize(new THREE.Vector3());
    const longest = Math.max(span.x, span.y, span.z);
    if (!(longest > 0)) throw new Error('this model has no size');

    const scale = size / longest;
    const dim = {
        x: Math.max(Math.ceil(span.x * scale), 1),
        y: Math.max(Math.ceil(span.y * scale), 1),
        z: Math.max(Math.ceil(span.z * scale), 1),
    };
    const cells = new Map();
    // The face normal of every triangle that landed in a cell, summed. This is the
    // real surface direction; recovering one from the filled cells afterwards can
    // only ever approximate it, and on a fine grid it is mostly rasterisation noise.
    const norms = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const face = new THREE.Vector3();

    const slot = (v, n) => Math.min(Math.max(Math.floor(v), 0), n - 1);
    const put = (x, y, z, rgb) => {
        const key = (slot(y, dim.y) * dim.z + slot(z, dim.z)) * dim.x + slot(x, dim.x);
        cells.set(key, rgb);
        const n = norms.get(key);
        if (n) {
            n[0] += face.x;
            n[1] += face.y;
            n[2] += face.z;
        } else {
            norms.set(key, [face.x, face.y, face.z]);
        }
    };

    for (const mesh of meshes) {
        const { rgb, sample } = materialOf(mesh);
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const uv = sample ? geo.attributes.uv : null;
        const index = geo.index;
        const faces = index ? index.count / 3 : pos.count / 3;

        for (let f = 0; f < faces; f++) {
            const i0 = index ? index.getX(f * 3) : f * 3;
            const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
            const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
            a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
            b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
            c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

            // Built from the world-space corners, so it needs no normal matrix.
            face.copy(e1.subVectors(b, a).cross(e2.subVectors(c, a)));
            if (face.lengthSq() > 0) face.normalize();

            let colour = rgb;
            if (uv) {
                const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
                const v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
                colour = sample(u, v) ?? rgb;
            }

            const steps = Math.max(
                Math.ceil(a.distanceTo(b) * scale),
                Math.ceil(b.distanceTo(c) * scale),
                Math.ceil(a.distanceTo(c) * scale),
                1,
            ) * 2;

            for (let i = 0; i <= steps; i++) {
                for (let j = 0; j <= steps - i; j++) {
                    const w0 = i / steps;
                    const w1 = j / steps;
                    const w2 = 1 - w0 - w1;
                    p.set(
                        a.x * w0 + b.x * w1 + c.x * w2,
                        a.y * w0 + b.y * w1 + c.y * w2,
                        a.z * w0 + b.z * w1 + c.z * w2,
                    );
                    put(
                        (p.x - box.min.x) * scale,
                        (p.y - box.min.y) * scale,
                        (p.z - box.min.z) * scale,
                        colour,
                    );
                }
            }
        }
    }

    return { dim, cells, norms };
}

export function fillInside(grid) {
    const { dim, cells } = grid;
    const total = dim.x * dim.y * dim.z;
    const outside = new Uint8Array(total);
    const queue = [];

    const at = (x, y, z) => (y * dim.z + z) * dim.x + x;
    const push = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= dim.x || y >= dim.y || z >= dim.z) return;
        const i = at(x, y, z);
        if (outside[i] || cells.has(i)) return;
        outside[i] = 1;
        queue.push(x, y, z);
    };

    for (let y = 0; y < dim.y; y++) {
        for (let z = 0; z < dim.z; z++) { push(0, y, z); push(dim.x - 1, y, z); }
    }
    for (let x = 0; x < dim.x; x++) {
        for (let z = 0; z < dim.z; z++) { push(x, 0, z); push(x, dim.y - 1, z); }
    }
    for (let x = 0; x < dim.x; x++) {
        for (let y = 0; y < dim.y; y++) { push(x, y, 0); push(x, y, dim.z - 1); }
    }

    while (queue.length) {
        const z = queue.pop();
        const y = queue.pop();
        const x = queue.pop();
        push(x + 1, y, z); push(x - 1, y, z);
        push(x, y + 1, z); push(x, y - 1, z);
        push(x, y, z + 1); push(x, y, z - 1);
    }

    let r = 0;
    let g = 0;
    let b = 0;
    for (const rgb of cells.values()) { r += rgb[0]; g += rgb[1]; b += rgb[2]; }
    const n = Math.max(cells.size, 1);
    const core = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];

    for (let i = 0; i < total; i++) {
        if (!outside[i] && !cells.has(i)) cells.set(i, core);
    }
    return grid;
}

// A normal component is a byte, 128 meaning zero. A cell with no triangle in it -
// the inside of a filled model - encodes as (0, 0, 0) and reads back as "unknown".
const nhex = (v) => hex(Math.min(255, Math.max(0, Math.round(v * 127) + 128)));

export function encode(grid) {
    const { dim, cells, norms } = grid;
    const keys = [...cells.keys()].sort((p, q) => p - q);
    const out = [];
    for (const key of keys) {
        const x = key % dim.x;
        const rest = (key - x) / dim.x;
        const z = rest % dim.z;
        const y = (rest - z) / dim.z;
        const [r, g, b] = cells.get(key);
        const n = norms?.get(key);
        const len = n ? Math.hypot(n[0], n[1], n[2]) : 0;
        const s = len > 1e-9 ? 1 / len : 0;
        out.push(
            chex(x) + chex(y) + chex(z) + hex(r) + hex(g) + hex(b)
            + nhex(n ? n[0] * s : 0) + nhex(n ? n[1] * s : 0) + nhex(n ? n[2] * s : 0),
        );
    }
    return { w: dim.x, h: dim.y, d: dim.z, count: keys.length, data: out.join('') };
}

export async function buildVoxels(object, res, solid, maxRes = MAX_RES) {
    const grid = voxelize(object, res, maxRes);
    return encode(solid ? fillInside(grid) : grid);
}
