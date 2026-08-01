import * as THREE from 'three';

export const MAX_RES = 160;

const hex = (n) => n.toString(16).padStart(2, '0');
// Three digits, because a coordinate is not a byte: an admin may voxelise past 255
// on an axis, and a 2-digit overflow used to shift every field after it.
export const MAX_DIM = 4096;
const chex = (n) => n.toString(16).padStart(3, '0');

const MAX_TEX = 2048;
const ALPHA_CUT = 128;
// Two surfaces within this much of a cell, measured along the normal, are the same
// surface. Clothing sits a hair above the body it covers, so at a fine resolution
// both land in one cell and averaging them makes a colour neither of them is.
const DEPTH_EPS = 0.15;
const GREY = [170, 170, 170];

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
    const v = i / 255;
    SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const byte = (v) => Math.max(0, Math.min(255, Math.round(toSrgb(v) * 255)));

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

function wrapped(t, mode) {
    if (mode === THREE.RepeatWrapping) return t - Math.floor(t);
    if (mode === THREE.MirroredRepeatWrapping) {
        const f = Math.abs(t) % 2;
        return f > 1 ? 2 - f : f;
    }
    return Math.min(Math.max(t, 0), 1);
}

// No more of the atlas than the grid can tell apart. Reading a 4096 square for a
// 48 cell model costs seconds and resolves nothing.
function texCap(size) {
    const want = 1 << Math.ceil(Math.log2(Math.max(size, 1) * 4));
    return Math.min(MAX_TEX, Math.max(64, want));
}

function textureSampler(map, cap) {
    const img = map?.image;
    if (!img || !img.width || !img.height) return null;
    const w = Math.min(img.width, cap);
    const h = Math.min(img.height, cap);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    // An atlas is islands of colour on blank padding, and a smoothed downscale
    // averages the two together along every island border.
    g.imageSmoothingEnabled = false;
    let data;
    try {
        // Five arguments: the three-argument form draws at intrinsic size and
        // crops, so every model was coloured from the corner of its atlas.
        g.drawImage(img, 0, 0, w, h);
        ({ data } = g.getImageData(0, 0, w, h));
    } catch {
        return null;
    }

    // glTF puts v = 0 at the top row and leaves flipY off; OBJ flips.
    const flip = map.flipY === true;
    if (map.matrixAutoUpdate !== false) map.updateMatrix();
    const e = map.matrix?.elements;
    const moved = !!e && (e[0] !== 1 || e[4] !== 1 || e[1] !== 0 || e[3] !== 0
        || e[6] !== 0 || e[7] !== 0);

    return (u, v) => {
        const s = wrapped(moved ? e[0] * u + e[3] * v + e[6] : u, map.wrapS);
        const t = wrapped(moved ? e[1] * u + e[4] * v + e[7] : v, map.wrapT);
        const x = Math.min(Math.max(Math.floor(s * w), 0), w - 1);
        const y = Math.min(Math.max(Math.floor((flip ? 1 - t : t) * h), 0), h - 1);
        const i = (y * w + x) * 4;
        // Nearest: filtering across a UV island border pulls the atlas's blank
        // padding into every seam.
        if (data[i + 3] < ALPHA_CUT) return null;
        return [data[i], data[i + 1], data[i + 2]];
    };
}

function collect(object) {
    object.updateMatrixWorld(true);
    const meshes = [];
    object.traverse((o) => {
        if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
    });
    return meshes;
}

function describe(m, cap) {
    if (!m) {
        return {
            rgb: GREY,
            linear: GREY.map((b) => SRGB_TO_LINEAR[b]),
            sample: null,
            tint: null,
            uvSet: 0,
            skip: false,
        };
    }
    const map = m.map ?? m.emissiveMap ?? null;
    const c = m.color ? m.color.clone().convertLinearToSRGB() : null;
    const rgb = c ? [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)] : GREY;
    // glTF multiplies baseColorFactor into the texture. m.color is linear here.
    const tint = m.color && (m.color.r !== 1 || m.color.g !== 1 || m.color.b !== 1)
        ? [m.color.r, m.color.g, m.color.b]
        : null;

    return {
        rgb,
        linear: rgb.map((b) => SRGB_TO_LINEAR[b]),
        sample: textureSampler(map, cap),
        tint,
        uvSet: map?.channel === 1 ? 1 : 0,
        // A blend material this faint is a helper plane, not something anyone can
        // see, and it would paint solid blocks over what is behind it.
        skip: m.transparent === true && m.opacity < 0.5,
    };
}

// A GLB usually ships hat, body and skin as groups of one mesh, so material[0]
// for every face paints most of the model from the wrong atlas.
function faceMaterials(geo, faces, materials) {
    if (materials < 2 || !geo.groups?.length) return null;
    const out = new Uint8Array(faces);
    for (const g of geo.groups) {
        const from = Math.max(0, Math.floor(g.start / 3));
        const to = Math.min(faces, from + Math.floor(g.count / 3));
        const index = Math.min(Math.max(g.materialIndex ?? 0, 0), 255);
        for (let f = from; f < to; f++) out[f] = index;
    }
    return out;
}

export function voxelize(object, res, maxRes = MAX_RES) {
    const size = Math.min(Math.max(Math.floor(res) || 32, 4), maxRes, MAX_DIM);
    const meshes = collect(object);
    if (!meshes.length) throw new Error('this file has no meshes');
    const cap = texCap(size);

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
    // Per cell: colour summed in linear light, the sample count, the depth of the
    // outermost surface seen, and the summed normal. Colour and normal are averaged
    // over the samples at that depth only; anything further in is hidden behind it.
    const acc = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const face = new THREE.Vector3();

    const slot = (v, n) => Math.min(Math.max(Math.floor(v), 0), n - 1);
    const put = (x, y, z, r, g, bl) => {
        const key = (slot(y, dim.y) * dim.z + slot(z, dim.z)) * dim.x + slot(x, dim.x);
        // Where the sample's own tangent plane sits. Two shells with the same normal
        // differ here by how far out they are, so the larger value is the outer one.
        const t = x * face.x + y * face.y + z * face.z;
        const cell = acc.get(key);
        if (!cell) {
            acc.set(key, [r, g, bl, 1, t, face.x, face.y, face.z]);
            return;
        }
        if (t > cell[4] + DEPTH_EPS) {
            acc.set(key, [r, g, bl, 1, t, face.x, face.y, face.z]);
            return;
        }
        if (t < cell[4] - DEPTH_EPS) return;
        cell[0] += r;
        cell[1] += g;
        cell[2] += bl;
        cell[3] += 1;
        if (t > cell[4]) cell[4] = t;
        cell[5] += face.x;
        cell[6] += face.y;
        cell[7] += face.z;
    };

    const normalMatrix = new THREE.Matrix3();
    const na = new THREE.Vector3();
    const nb = new THREE.Vector3();
    const nc = new THREE.Vector3();
    // Per sample, not set by the first hit: one textured triangle used to claim
    // the whole model.
    const used = { texture: 0, vertex: 0, flat: 0 };

    for (const mesh of meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const mats = list.map((m) => describe(m, cap));
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const uvs = [geo.attributes.uv ?? null, geo.attributes.uv1 ?? geo.attributes.uv ?? null];
        // The artist's own normals, which on a smooth-shaded model describe the
        // surface the mesh stands for rather than the triangles it is made of.
        const nrm = geo.attributes.normal;
        // Scans and sculpts usually carry their colour per vertex, not in a texture.
        const vcol = geo.attributes.color;
        normalMatrix.getNormalMatrix(mesh.matrixWorld);
        const index = geo.index;
        const faces = Math.floor((index ? index.count : pos.count) / 3);
        const perFace = faceMaterials(geo, faces, mats.length);

        for (let f = 0; f < faces; f++) {
            const mat = mats[perFace ? perFace[f] : 0] ?? mats[0];
            if (mat.skip) continue;
            const uv = mat.sample ? uvs[mat.uvSet] : null;
            const i0 = index ? index.getX(f * 3) : f * 3;
            const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
            const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
            a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
            b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
            c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

            // Built from the world-space corners, so it needs no normal matrix.
            face.copy(e1.subVectors(b, a).cross(e2.subVectors(c, a)));
            if (face.lengthSq() > 0) face.normalize();
            if (nrm) {
                na.fromBufferAttribute(nrm, i0).applyMatrix3(normalMatrix);
                nb.fromBufferAttribute(nrm, i1).applyMatrix3(normalMatrix);
                nc.fromBufferAttribute(nrm, i2).applyMatrix3(normalMatrix);
            }

            const u0 = uv ? uv.getX(i0) : 0;
            const u1 = uv ? uv.getX(i1) : 0;
            const u2 = uv ? uv.getX(i2) : 0;
            const v0 = uv ? uv.getY(i0) : 0;
            const v1 = uv ? uv.getY(i1) : 0;
            const v2 = uv ? uv.getY(i2) : 0;
            const cr0 = vcol ? vcol.getX(i0) : 0;
            const cg0 = vcol ? vcol.getY(i0) : 0;
            const cb0 = vcol ? vcol.getZ(i0) : 0;
            const cr1 = vcol ? vcol.getX(i1) : 0;
            const cg1 = vcol ? vcol.getY(i1) : 0;
            const cb1 = vcol ? vcol.getZ(i1) : 0;
            const cr2 = vcol ? vcol.getX(i2) : 0;
            const cg2 = vcol ? vcol.getY(i2) : 0;
            const cb2 = vcol ? vcol.getZ(i2) : 0;
            const tint = mat.tint;

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
                    let lr = mat.linear[0];
                    let lg = mat.linear[1];
                    let lb = mat.linear[2];
                    if (uv) {
                        const hit = mat.sample(
                            u0 * w0 + u1 * w1 + u2 * w2,
                            v0 * w0 + v1 * w1 + v2 * w2,
                        );
                        // Below the cutout there is no surface here at all.
                        if (!hit) continue;
                        lr = SRGB_TO_LINEAR[hit[0]];
                        lg = SRGB_TO_LINEAR[hit[1]];
                        lb = SRGB_TO_LINEAR[hit[2]];
                        if (tint) {
                            lr *= tint[0];
                            lg *= tint[1];
                            lb *= tint[2];
                        }
                        // glTF multiplies COLOR_0 into the base colour, and a
                        // mesh often carries its shading there.
                        if (vcol) {
                            lr *= cr0 * w0 + cr1 * w1 + cr2 * w2;
                            lg *= cg0 * w0 + cg1 * w1 + cg2 * w2;
                            lb *= cb0 * w0 + cb1 * w1 + cb2 * w2;
                        }
                        used.texture += 1;
                    } else if (vcol) {
                        lr = cr0 * w0 + cr1 * w1 + cr2 * w2;
                        lg = cg0 * w0 + cg1 * w1 + cg2 * w2;
                        lb = cb0 * w0 + cb1 * w1 + cb2 * w2;
                        if (tint) {
                            lr *= tint[0];
                            lg *= tint[1];
                            lb *= tint[2];
                        }
                        used.vertex += 1;
                    } else {
                        used.flat += 1;
                    }
                    p.set(
                        a.x * w0 + b.x * w1 + c.x * w2,
                        a.y * w0 + b.y * w1 + c.y * w2,
                        a.z * w0 + b.z * w1 + c.z * w2,
                    );
                    if (nrm) {
                        face.set(
                            na.x * w0 + nb.x * w1 + nc.x * w2,
                            na.y * w0 + nb.y * w1 + nc.y * w2,
                            na.z * w0 + nb.z * w1 + nc.z * w2,
                        );
                        if (face.lengthSq() > 0) face.normalize();
                    }
                    put(
                        (p.x - box.min.x) * scale,
                        (p.y - box.min.y) * scale,
                        (p.z - box.min.z) * scale,
                        lr,
                        lg,
                        lb,
                    );
                }
            }
        }
    }

    const cells = new Map();
    const norms = new Map();
    for (const [key, cell] of acc) {
        const w = cell[3] || 1;
        cells.set(key, [byte(cell[0] / w), byte(cell[1] / w), byte(cell[2] / w)]);
        norms.set(key, [cell[5], cell[6], cell[7]]);
    }

    let source = 'flat';
    if (used.texture >= used.vertex && used.texture > 0) source = 'texture';
    else if (used.vertex > 0) source = 'vertex';

    return { dim, cells, norms, source };
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

    // Nearest shell colour, grown inward. One average for the whole model reads as
    // grey mud wherever the shell is thin enough to see through.
    const front = [...cells.keys()];
    for (let head = 0; head < front.length; head++) {
        const key = front[head];
        const x = key % dim.x;
        const rest = (key - x) / dim.x;
        const z = rest % dim.z;
        const y = (rest - z) / dim.z;
        const rgb = cells.get(key);
        const grow = (nx, ny, nz) => {
            if (nx < 0 || ny < 0 || nz < 0 || nx >= dim.x || ny >= dim.y || nz >= dim.z) return;
            const i = at(nx, ny, nz);
            if (outside[i] || cells.has(i)) return;
            cells.set(i, rgb);
            front.push(i);
        };
        grow(x + 1, y, z); grow(x - 1, y, z);
        grow(x, y + 1, z); grow(x, y - 1, z);
        grow(x, y, z + 1); grow(x, y, z - 1);
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
    return {
        w: dim.x, h: dim.y, d: dim.z, count: keys.length, data: out.join(''), source: grid.source,
    };
}

export async function buildVoxels(object, res, solid, maxRes = MAX_RES) {
    const grid = voxelize(object, res, maxRes);
    return encode(solid ? fillInside(grid) : grid);
}
