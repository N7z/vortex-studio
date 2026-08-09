import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lookOf, materialOf } from './materials';
import { compositeAlbedo, materialMaps, studsPerTile } from './materialmaps';

export const PLACEHOLDER = new THREE.MeshBasicMaterial();

export const PART_TYPES = ['Part', 'SpawnLocation', 'ShirtPad', 'Truss'];

const FACE_MARKS = {
    Part: { Top: 'stud', Bottom: 'inlet' },
    SpawnLocation: { Top: 'spawn', Bottom: 'inlet' },
    ShirtPad: {
        Front: 'shirt', Back: 'shirt', Left: 'shirt', Right: 'shirt', Top: 'stud', Bottom: 'inlet',
    },
    Truss: {},
};

const FACES = ['Right', 'Left', 'Front', 'Back', 'Top', 'Bottom'];

const MARK_OF = { Studs: 'stud', Inlets: 'inlet' };

const REPEATING = new Set(['stud', 'inlet']);

export function partType(part) {
    return PART_TYPES.includes(part.T) ? part.T : 'Part';
}

function marksFor(type, mode, studs, textures) {
    if (mode === 'wireframe' || mode === 'normals') return null;
    const spec = { ...(FACE_MARKS[type] ?? FACE_MARKS.Part) };
    if (type !== 'Truss') {
        for (const [face, kind] of Object.entries(textures ?? {})) {
            if (MARK_OF[kind]) spec[face] = MARK_OF[kind];
        }
    }
    let any = false;
    const out = {};
    for (const [face, mark] of Object.entries(spec)) {
        if (!studs && REPEATING.has(mark)) continue;
        out[face] = mark;
        any = true;
    }
    return any ? out : null;
}

export function makePartGeometry() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const src = Array.from(geo.index.array);
    const face = (f) => src.slice(f * 6, f * 6 + 6);
    const index = [];
    // BoxGeometry groups run +X, -X, +Y, -Y, +Z, -Z.
    for (const f of [0, 1, 4, 5, 2, 3]) index.push(...face(f));
    geo.setIndex(index);
    geo.clearGroups();
    for (let i = 0; i < FACES.length; i++) geo.addGroup(i * 6, 6, i);
    return geo;
}

const BAR = 0.12;

export function makeTrussGeometry() {
    const off = 0.5 - BAR / 2;
    const diag = Math.SQRT2 - BAR;
    const bars = [];
    const add = (geo, x, y, z, rot) => {
        if (rot) geo[rot[0]](rot[1]);
        geo.translate(x, y, z);
        bars.push(geo);
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
        add(new THREE.BoxGeometry(diag, BAR, BAR), 0, 0, sz * off, ['rotateZ', (sz * Math.PI) / 4]);
    }
    for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(BAR, BAR, diag), sx * off, 0, 0, ['rotateX', (sx * Math.PI) / 4]);
    }

    const merged = mergeGeometries(bars, false);
    for (const g of bars) g.dispose();
    merged.clearGroups();
    return merged;
}

function dressStandard(m, maps, map) {
    if (!maps) return m;
    m.map = map ?? maps.albedo;
    if (maps.normal) m.normalMap = maps.normal;
    if (maps.orm) {
        m.roughnessMap = maps.orm;
        m.metalnessMap = maps.orm;
    }
    m.needsUpdate = true;

    return m;
}

function baseMaterial(mode, color, opacity, material) {
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
            return new THREE.MeshStandardMaterial({
                color: new THREE.Color(`#${color}`), ...lookOf(material), ...common,
            });
    }
}

const repeatPatch = (studs) => `#include <uv_vertex>
#if defined( USE_INSTANCING )
    vec3 partSize = vec3(
        length(instanceMatrix[0].xyz),
        length(instanceMatrix[1].xyz),
        length(instanceMatrix[2].xyz)
    );
    vec3 faceAxis = abs(normal);
    vec2 studScale;
    if (faceAxis.y > 0.5) {
        studScale = vec2(partSize.x, partSize.z);
    } else if (faceAxis.z > 0.5) {
        studScale = vec2(partSize.x, partSize.y);
    } else {
        studScale = vec2(partSize.z, partSize.y);
    }
    studScale = max(vec2(1.0), floor(studScale + 0.5)) / float(${studs});
    #ifdef USE_MAP
        vMapUv *= studScale;
    #endif
    #ifdef USE_NORMALMAP
        vNormalMapUv *= studScale;
    #endif
    #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv *= studScale;
    #endif
    #ifdef USE_METALNESSMAP
        vMetalnessMapUv *= studScale;
    #endif
#endif`;

function repeatByInstance(material, studs) {
    const patch = repeatPatch(studs);
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', patch);
    };
    material.customProgramCacheKey = () => `instanced-stud-repeat-${studs}`;
    return material;
}

export function makeMaterialSets(tex, onDressed = null) {
    const sets = new Map();
    const maps = new Map();

    const mapFor = (mark, rx, rz) => {
        if (!REPEATING.has(mark)) return tex[mark];
        const key = `${mark}|${rx}|${rz}`;
        let m = maps.get(key);
        if (!m) {
            m = tex[mark].clone();
            m.repeat.set(rx, rz);
            m.needsUpdate = true;
            maps.set(key, m);
        }
        return m;
    };

    const build = (type, mode, color, opacity, marks, rx, rz, instanced, material) => {
        const lit = mode !== 'wireframe' && mode !== 'normals' && mode !== 'unlit';
        const base = baseMaterial(mode, color, opacity, material);
        if (lit && instanced) repeatByInstance(base, 1);
        const dressable = lit && instanced ? [{ m: base, mark: null }] : [];
        if (!marks) return { materials: base, own: [base], dressable };

        const own = [base];
        const materials = FACES.map((face) => {
            const mark = marks[face];
            if (!mark) return base;
            const repeats = REPEATING.has(mark);
            const map = instanced && repeats ? tex[mark] : mapFor(mark, rx, rz);
            const m = mode === 'unlit'
                ? new THREE.MeshBasicMaterial({ map })
                : new THREE.MeshStandardMaterial({ map, ...lookOf(material) });
            m.color.copy(base.color);
            m.transparent = base.transparent;
            m.opacity = base.opacity;
            own.push(instanced && repeats ? repeatByInstance(m, 1) : m);
            if (lit && instanced && repeats) dressable.push({ m, mark });
            return m;
        });

        return { materials, own, dressable };
    };

    let alive = true;
    const dress = (entry) => {
        if (!entry.dressable?.length) return;
        materialMaps(entry.material).then((found) => {
            if (!alive || !found || !sets.has(entry.key)) return;
            const tiling = studsPerTile(entry.material);
            for (const { m, mark } of entry.dressable) {
                const map = mark
                    ? compositeAlbedo(entry.material, mark, found.albedo)
                    : found.albedo;
                dressStandard(m, found, map);
                repeatByInstance(m, tiling);
                m.needsUpdate = true;
            }
            onDressed?.();
        });
    };

    return {
        acquire(part, mode, studs) {
            const type = partType(part);
            const normals = mode === 'normals';
            const opacity = normals ? 1 : 1 - (part.Tr ?? 0);
            const transparent = opacity < 1;
            const material = materialOf(part);
            const textures = part.Tx;
            const marks = marksFor(type, mode, studs, textures);

            const color = normals || !transparent ? '' : (part.C ?? 'a3a2a5');
            const repeats = !!marks && FACES.some((f) => REPEATING.has(marks[f]));
            const rx = repeats && transparent ? Math.max(1, Math.round(part.S[0])) : 0;
            const rz = repeats && transparent ? Math.max(1, Math.round(part.S[2])) : 0;
            const marked = marks ? FACES.map((f) => marks[f] ?? '').join(',') : '';
            const key = `${type}|${mode}|${studs ? 1 : 0}|${color}|${opacity}|${rx}|${rz}`
                + `|${material}|${marked}`;

            let e = sets.get(key);
            if (!e) {
                e = {
                    ...build(type, mode, color || 'ffffff', opacity, marks, rx, rz, !transparent, material),
                    key,
                    type,
                    material,
                    transparent,
                    instanced: !transparent && !normals,
                    n: 0,
                };
                sets.set(key, e);
                dress(e);
            }
            e.n += 1;
            return e;
        },
        release(set) {
            const e = set && sets.get(set.key);
            if (!e) return;
            e.n -= 1;
            if (e.n <= 0) {
                sets.delete(e.key);
                for (const m of e.own) m.dispose();
            }
        },
        dispose() {
            alive = false;
            for (const e of sets.values()) for (const m of e.own) m.dispose();
            for (const m of maps.values()) m.dispose();
            sets.clear();
            maps.clear();
        },
        get size() {
            return sets.size;
        },
    };
}
