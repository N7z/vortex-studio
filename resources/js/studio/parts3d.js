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

export function makeMaterialPool() {
    const pool = new Map();
    return {
        acquire(color, opacity) {
            const key = `${color}|${opacity}`;
            let e = pool.get(key);
            if (!e) {
                const m = new THREE.MeshStandardMaterial({
                    color: new THREE.Color(`#${color}`),
                    transparent: opacity < 1,
                    opacity,
                });
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
