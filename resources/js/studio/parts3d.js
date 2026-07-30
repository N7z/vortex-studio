import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PLACEHOLDER = new THREE.MeshBasicMaterial();

export const PART_TYPES = ['Part', 'SpawnLocation', 'ShirtPad', 'Truss'];

export const FACE_MARKS = {
    Part: { top: 'stud', bottom: 'inlet' },
    SpawnLocation: { top: 'spawn', bottom: 'inlet' },
    ShirtPad: { sides: 'shirt', top: 'stud', bottom: 'inlet' },
    Truss: {},
};

const DECORATIVE = new Set(['stud', 'inlet']);

export function faceMarks(type, studs) {
    const spec = FACE_MARKS[type] ?? FACE_MARKS.Part;
    const out = {};
    for (const [face, mark] of Object.entries(spec)) {
        if (studs || !DECORATIVE.has(mark)) out[face] = mark;
    }
    return out;
}

export function releaseFaces(mesh) {
    const d = mesh.userData;
    if (!d.faces) return;
    for (const m of d.faces) m.dispose();
    for (const t of d.faceMaps) t.dispose();
    d.faces = null;
    d.faceMaps = null;
    d.slots = null;
    d.faceKey = null;
}

export function makeFaceMaterial(mode, map) {
    if (mode === 'wireframe' || mode === 'normals') return null;
    return mode === 'unlit'
        ? new THREE.MeshBasicMaterial({ map })
        : new THREE.MeshStandardMaterial({ map });
}

export function makePartGeometry() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const src = Array.from(geo.index.array);
    const face = (f) => src.slice(f * 6, f * 6 + 6);
    const index = [];
    for (const f of [0, 1, 4, 5]) index.push(...face(f));
    index.push(...face(2), ...face(3));
    geo.setIndex(index);
    geo.clearGroups();
    geo.addGroup(0, 24, 0);
    geo.addGroup(24, 6, 1);
    geo.addGroup(30, 6, 2);
    return geo;
}

const BAR = 0.12;

export function makeTrussGeometry() {
    const off = 0.5 - BAR / 2;
    const diag = Math.SQRT2 - BAR;
    const parts = [];
    const add = (geo, x, y, z, rot) => {
        if (rot) geo[rot[0]](rot[1]);
        geo.translate(x, y, z);
        parts.push(geo);
    };

    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            add(new THREE.BoxGeometry(BAR, 1, BAR), sx * off, 0, sz * off);
        }
    }
    for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
            add(new THREE.BoxGeometry(1, BAR, BAR), 0, sy * off, sz * off);
        }
        for (const sx of [-1, 1]) {
            add(new THREE.BoxGeometry(BAR, BAR, 1), sx * off, sy * off, 0);
        }
    }
    for (const sz of [-1, 1]) {
        add(new THREE.BoxGeometry(diag, BAR, BAR), 0, 0, sz * off, ['rotateZ', sz * Math.PI / 4]);
    }
    for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(BAR, BAR, diag), sx * off, 0, 0, ['rotateX', sx * Math.PI / 4]);
    }

    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    merged.clearGroups();
    return merged;
}

function makeModeMaterial(mode, color, opacity) {
    const common = { transparent: opacity < 1, opacity };
    switch (mode) {
        case 'normals':
            return new THREE.MeshNormalMaterial();
        case 'wireframe':
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(`#${color}`), wireframe: true, ...common,
            });
        case 'unlit':
            return new THREE.MeshBasicMaterial({ color: new THREE.Color(`#${color}`), ...common });
        default:
            return new THREE.MeshStandardMaterial({ color: new THREE.Color(`#${color}`), ...common });
    }
}

export function makeMaterialPool() {
    const pool = new Map();
    return {
        acquire(color, opacity, mode = 'lit') {
            const key = mode === 'normals' ? 'normals' : `${mode}|${color}|${opacity}`;
            let e = pool.get(key);
            if (!e) {
                const m = makeModeMaterial(mode, color, opacity);
                m.userData.key = key;
                e = { m, n: 0 };
                pool.set(key, e);
            }
            e.n += 1;
            return e.m;
        },
        release(material) {
            const e = material && pool.get(material.userData.key);
            if (!e) return;
            e.n -= 1;
            if (e.n <= 0) {
                pool.delete(material.userData.key);
                e.m.dispose();
            }
        },
        dispose() {
            for (const e of pool.values()) e.m.dispose();
            pool.clear();
        },
        get size() {
            return pool.size;
        },
    };
}
