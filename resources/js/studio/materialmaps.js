import * as THREE from 'three';
import { drawMark } from './facemarks';

const BASE = '/materials';

const TILING = {
    grass: 16,
    wood: 8,
    metal: 4,
    paint: 4,
    ice: 2,
};

const DEFAULT_TILING = 2;

export const studsPerTile = (name) => TILING[String(name ?? '').toLowerCase()] ?? DEFAULT_TILING;

const tileSize = (studs) => Math.min(Math.max(256 * studs, 512), 1024);

const loader = new THREE.TextureLoader();

const sets = new Map();

const load = (url, colorSpace) => new Promise((resolve) => {
    loader.load(
        url,
        (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            if (colorSpace) tex.colorSpace = colorSpace;
            resolve(tex);
        },
        undefined,
        () => resolve(null),
    );
});

export function materialMaps(name) {
    const key = String(name ?? '').toLowerCase();
    let pending = sets.get(key);
    if (pending) return pending;

    pending = Promise.all([
        load(`${BASE}/${key}_albedo.webp`, THREE.SRGBColorSpace),
        load(`${BASE}/${key}_normal.webp`, null),
        load(`${BASE}/${key}_orm.webp`, null),
    ]).then(([albedo, normal, orm]) => (albedo ? { albedo, normal, orm } : null));

    sets.set(key, pending);

    return pending;
}

const composites = new Map();

export function compositeAlbedo(name, mark, albedo) {
    const key = `${name}|${mark}`;
    let tex = composites.get(key);
    if (tex) return tex;

    const studs = studsPerTile(name);
    const size = tileSize(studs);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    g.drawImage(albedo.image, 0, 0, size, size);
    g.globalCompositeOperation = 'multiply';
    const step = size / studs;
    const stud = drawMark(mark, step);
    for (let x = 0; x < studs; x++) {
        for (let y = 0; y < studs; y++) g.drawImage(stud, x * step, y * step);
    }

    tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    composites.set(key, tex);

    return tex;
}

export function disposeMaterialMaps() {
    for (const tex of composites.values()) tex.dispose();
    composites.clear();
    for (const pending of sets.values()) {
        pending.then((set) => {
            if (!set) return;
            for (const tex of Object.values(set)) tex?.dispose();
        });
    }
    sets.clear();
}
