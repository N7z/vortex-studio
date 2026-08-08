import * as THREE from 'three';
import { drawMark } from './facemarks';

// The scanned PBR maps under public/materials, built by scripts/build-materials.sh.
// A material with no files on disk simply has none: Plastic is the untextured look
// the editor always had, and anything still missing falls back to it rather than
// failing, so dropping a new set in is all it takes to light one up.

const BASE = '/materials';

// How many studs one tile of material spans, per material. A scan has a real-world
// size and they are not the same size: ice reads well tight, while grass at the same
// tiling is fine noise instead of a lawn. The mark is drawn once per stud inside the
// tile and the shader divides the per-instance repeat by the same number, so however
// big the tile is the studs still land one per stud.
const TILING = {
    grass: 16,
    wood: 8,
    metal: 4,
    paint: 4,
    ice: 2,
};

const DEFAULT_TILING = 2;

export const studsPerTile = (name) => TILING[String(name ?? '').toLowerCase()] ?? DEFAULT_TILING;

// The composite's resolution, chosen so a stud keeps a decent share of it however
// many of them the tile spans. Capped: a tile is one texture in memory per material
// and mark, and past this the detail costs more than it shows.
const tileSize = (studs) => Math.min(Math.max(256 * studs, 512), 1024);

const loader = new THREE.TextureLoader();

/** @type {Map<string, Promise<{albedo, normal, orm}|null>>} */
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
        // A material with no files is the normal case, not an error worth shouting
        // about: Plastic has none by design and a new set may not be built yet.
        () => resolve(null),
    );
});

/**
 * The three maps for a material, or null when it ships none. Loaded once and shared;
 * every caller of the same name gets the same promise and the same textures.
 */
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

/**
 * A material's albedo with a face mark drawn into it. The marks are dark shapes on
 * white, so multiplying keeps the material underneath and the stud on top, which is
 * the whole point: the top of a wooden part should still read as wood.
 *
 * Compositing rather than combining in a shader also means the pair tiles as one
 * texture, so the studs and the grain stay locked together however the part is sized.
 */
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
    // Drawn at the material's resolution rather than scaled up from the viewport's
    // 64px tile, which would leave the studs soft against a sharp material. One per
    // stud, however many studs the tile spans.
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
