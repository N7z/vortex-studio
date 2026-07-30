import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PLACEHOLDER = new THREE.MeshBasicMaterial();

export const PART_TYPES = ['Part', 'SpawnLocation', 'ShirtPad', 'Truss'];

const FACE_MARKS = {
    Part: { top: 'stud', bottom: 'inlet' },
    SpawnLocation: { top: 'spawn', bottom: 'inlet' },
    ShirtPad: { sides: 'shirt', top: 'stud', bottom: 'inlet' },
    Truss: {},
};

const FACES = ['sides', 'top', 'bottom'];
const REPEATING = new Set(['stud', 'inlet']);

export function partType(part) {
    return PART_TYPES.includes(part.T) ? part.T : 'Part';
}

function marksFor(type, mode, studs) {
    if (mode === 'wireframe' || mode === 'normals') return null;
    const spec = FACE_MARKS[type] ?? FACE_MARKS.Part;
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

function baseMaterial(mode, color, opacity) {
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

export function makeMaterialSets(tex) {
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

    const build = (type, mode, color, opacity, marks, rx, rz) => {
        const base = baseMaterial(mode, color, opacity);
        if (!marks) return { materials: base, own: [base] };
        const own = [base];
        const materials = FACES.map((face) => {
            const mark = marks[face];
            if (!mark) return base;
            const map = mapFor(mark, rx, rz);
            const m = mode === 'unlit'
                ? new THREE.MeshBasicMaterial({ map })
                : new THREE.MeshStandardMaterial({ map });
            m.color.copy(base.color);
            m.transparent = base.transparent;
            m.opacity = base.opacity;
            own.push(m);
            return m;
        });
        return { materials, own };
    };

    return {
        acquire(part, mode, studs) {
            const type = partType(part);
            const normals = mode === 'normals';
            const color = normals ? '' : (part.C ?? 'a3a2a5');
            const opacity = normals ? 1 : 1 - (part.Tr ?? 0);
            const marks = marksFor(type, mode, studs);
            const repeats = !!marks && FACES.some((f) => REPEATING.has(marks[f]));
            const rx = repeats ? Math.max(1, Math.round(part.S[0])) : 0;
            const rz = repeats ? Math.max(1, Math.round(part.S[2])) : 0;
            const key = `${type}|${mode}|${color}|${opacity}|${rx}|${rz}`;

            let e = sets.get(key);
            if (!e) {
                e = {
                    ...build(type, mode, color, opacity, marks, rx, rz),
                    key,
                    type,
                    transparent: opacity < 1,
                    n: 0,
                };
                sets.set(key, e);
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
