import * as THREE from 'three';
import { PART_TYPES } from './parts3d';
import { DEFAULT_COLOR } from './roblox';

const DEG = Math.PI / 180;
const MATERIAL = 'Plastic';

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, fallback = 0) => (isNum(v) ? v : fallback);
const clamp01 = (n) => Math.min(Math.max(n, 0), 1);
const round = (v) => Math.round(v * 1e6) / 1e6;

const byte = (n) => Math.min(Math.max(Math.round(n * 255), 0), 255).toString(16).padStart(2, '0');

function rgbOf(hex) {
    const s = String(hex ?? '').replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return rgbOf(DEFAULT_COLOR);

    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}

function vec3Of(v, fallback = [0, 0, 0]) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback;

    return [num(v.x, fallback[0]), num(v.y, fallback[1]), num(v.z, fallback[2])];
}

function quatOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;

    return new THREE.Quaternion(num(v.x), num(v.y), num(v.z), num(v.w, 1));
}

export const isProject = (doc) => !!doc
    && !Array.isArray(doc)
    && typeof doc === 'object'
    && Array.isArray(doc.parts)
    && doc.parts.some((p) => p && typeof p === 'object' && !Array.isArray(p)
        && (p.position !== undefined || p.scale !== undefined));

function partToProject(part, group) {
    const [rx, ry, rz] = part.R ?? [0, 0, 0];
    euler.set(rx * DEG, ry * DEG, rz * DEG);
    quat.setFromEuler(euler);
    const [x, y, z] = part.P ?? [0, 0, 0];
    const [sx, sy, sz] = part.S ?? [1, 1, 1];
    const [r, g, b] = rgbOf(part.C);
    const kind = typeof part.T === 'string' && part.T ? part.T : 'Part';

    return {
        name: kind,
        position: { x: num(x), y: num(y), z: num(z) },
        rotation: {
            x: round(quat.x), y: round(quat.y), z: round(quat.z), w: round(quat.w),
        },
        scale: { x: num(sx, 1), y: num(sy, 1), z: num(sz, 1) },
        color: {
            r: round(r), g: round(g), b: round(b), a: round(1 - clamp01(num(part.Tr))),
        },
        material: MATERIAL,
        group,
        cast_shadow: true,
        anchored: true,
        can_collide: true,
        spawn_location: kind === 'SpawnLocation',
        baseplate: false,
        truss: kind === 'Truss',
        textures: [],
    };
}

export function toProject(parts, groups = []) {
    const owner = new Map();
    for (const g of groups) for (const id of g.ids) owner.set(id, g.id);

    return {
        project_id: null,
        parts: parts.map((p) => partToProject(p, owner.get(p._id) ?? null)),
        lights: [],
        groups: groups.map((g) => ({ id: g.id, name: g.name })),
    };
}

function partFromProject(part) {
    const q = quatOf(part.rotation);
    let R = [0, 0, 0];
    if (q) {
        euler.setFromQuaternion(q.normalize());
        R = [euler.x / DEG, euler.y / DEG, euler.z / DEG].map(round);
    }
    const c = part.color && typeof part.color === 'object' ? part.color : {};
    const rgb = [num(c.r), num(c.g), num(c.b)];
    const unit = rgb.every((n) => n >= 0 && n <= 1);
    const scaled = unit ? rgb : rgb.map((n) => n / 255);
    const named = typeof part.name === 'string' ? part.name : '';
    let T = PART_TYPES.includes(named) ? named : 'Part';
    if (part.truss === true) T = 'Truss';
    else if (part.spawn_location === true) T = 'SpawnLocation';

    return {
        T,
        P: vec3Of(part.position).map(round),
        S: vec3Of(part.scale, [1, 1, 1]).map(round),
        R,
        C: scaled.map(byte).join(''),
        Tr: round(1 - clamp01(num(c.a, 1))),
        Shape: 'Block',
    };
}

export function fromProject(doc, limit = Infinity) {
    const list = Array.isArray(doc.parts) ? doc.parts : [];
    const parts = [];
    const slotsByGroup = new Map();
    let dropped = 0;
    let capped = false;

    for (const raw of list) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            dropped += 1;
            continue;
        }
        if (!raw.position || !raw.scale) {
            dropped += 1;
            continue;
        }
        if (parts.length >= limit) {
            capped = true;
            break;
        }
        const id = raw.group ?? raw.parent_group ?? null;
        if (typeof id === 'string' && id) {
            if (!slotsByGroup.has(id)) slotsByGroup.set(id, []);
            slotsByGroup.get(id).push(parts.length);
        }
        parts.push(partFromProject(raw));
    }

    const named = new Map();
    if (Array.isArray(doc.groups)) {
        for (const g of doc.groups) {
            if (g && typeof g.id === 'string' && typeof g.name === 'string') named.set(g.id, g.name);
        }
    }
    const groups = [...slotsByGroup.entries()]
        .map(([id, slots]) => ({ name: named.get(id) ?? 'Group', slots }))
        .filter((g) => g.slots.length);

    return {
        parts, groups, dropped, reshaped: 0, recolored: 0, capped, seen: list.length,
    };
}
