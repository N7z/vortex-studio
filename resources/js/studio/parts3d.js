import * as THREE from 'three';

export const PLACEHOLDER = new THREE.MeshBasicMaterial();

export function releaseStuds(mesh) {
    const d = mesh.userData;
    if (!d.top) return;
    d.top.dispose();
    d.bottom.dispose();
    d.studMap.dispose();
    d.inletMap.dispose();
    d.top = null;
    d.bottom = null;
    d.studMap = null;
    d.inletMap = null;
    d.slots = null;
    d.studMode = null;
}

export function makeStudMaterial(mode, map) {
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
