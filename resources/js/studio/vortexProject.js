import * as THREE from 'three';
import { PART_TYPES } from './parts3d';
import { DEFAULT_COLOR } from './roblox';
import {
    DEFAULT_MATERIAL, FACES, MATERIALS, TEXTURES,
    canCollide, castsShadow, isAnchored, isBaseplate, materialOf, texturesOf,
} from './materials';
import { DEFAULT_ILLUMINANCE, MAX_ILLUMINANCE, MAX_LIGHTS } from './lighting';
import { newPartId } from './ops';

const DEG = Math.PI / 180;

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

function eulerOf(rotation) {
    const q = quatOf(rotation);
    if (!q) return [0, 0, 0];
    euler.setFromQuaternion(q.normalize());

    return [euler.x / DEG, euler.y / DEG, euler.z / DEG].map(round);
}

function quatFrom([rx, ry, rz]) {
    euler.set(rx * DEG, ry * DEG, rz * DEG);
    quat.setFromEuler(euler);

    return {
        x: round(quat.x), y: round(quat.y), z: round(quat.z), w: round(quat.w),
    };
}

export const isProject = (doc) => !!doc
    && !Array.isArray(doc)
    && typeof doc === 'object'
    && Array.isArray(doc.parts)
    && doc.parts.some((p) => p && typeof p === 'object' && !Array.isArray(p)
        && (p.position !== undefined || p.scale !== undefined));

function partToProject(part, group) {
    const [x, y, z] = part.P ?? [0, 0, 0];
    const [sx, sy, sz] = part.S ?? [1, 1, 1];
    const [r, g, b] = rgbOf(part.C);
    const kind = typeof part.T === 'string' && part.T ? part.T : 'Part';
    const textures = texturesOf(part);
    const baseplate = isBaseplate(part);

    return {
        name: baseplate && kind === 'Part' ? 'Baseplate' : kind,
        position: { x: num(x), y: num(y), z: num(z) },
        rotation: quatFrom(part.R ?? [0, 0, 0]),
        scale: { x: num(sx, 1), y: num(sy, 1), z: num(sz, 1) },
        color: {
            r: round(r), g: round(g), b: round(b), a: round(1 - clamp01(num(part.Tr))),
        },
        material: materialOf(part),
        group,
        cast_shadow: castsShadow(part),
        anchored: isAnchored(part),
        can_collide: canCollide(part),
        spawn_location: kind === 'SpawnLocation',
        baseplate,
        truss: kind === 'Truss',
        textures: FACES.filter((f) => textures[f]).map((f) => ({ face: f, kind: textures[f] })),
    };
}

function lightToProject(light) {
    const [x, y, z] = light.P;
    const [r, g, b] = rgbOf(light.C);

    return {
        name: light.N,
        position: { x: num(x), y: num(y), z: num(z) },
        rotation: quatFrom(light.R),
        color: { r: round(r), g: round(g), b: round(b), a: 1 },
        illuminance: num(light.I, DEFAULT_ILLUMINANCE),
        shadows_enabled: light.Sd !== false,
    };
}

export function newProjectId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function toProject(parts, groups = [], projectId = newProjectId(), lights = []) {
    const owner = new Map();
    groups.forEach((g, at) => g.ids.forEach((id) => owner.set(id, at)));

    return {
        project_id: projectId,
        parts: parts.map((p) => partToProject(p, owner.get(p._id) ?? null)),
        lights: lights.map(lightToProject),
        groups: groups.map((g) => ({ name: g.name, parent_group: null })),
    };
}

function texturesFrom(list) {
    if (!Array.isArray(list)) return null;
    const out = {};
    for (const t of list) {
        if (!t || typeof t !== 'object') continue;
        if (FACES.includes(t.face) && TEXTURES.includes(t.kind)) out[t.face] = t.kind;
    }

    return Object.keys(out).length ? out : null;
}

function partFromProject(part) {
    const c = part.color && typeof part.color === 'object' ? part.color : {};
    const rgb = [num(c.r), num(c.g), num(c.b)];
    const unit = rgb.every((n) => n >= 0 && n <= 1);
    const scaled = unit ? rgb : rgb.map((n) => n / 255);
    const named = typeof part.name === 'string' ? part.name : '';
    let T = PART_TYPES.includes(named) ? named : 'Part';
    if (part.truss === true) T = 'Truss';
    else if (part.spawn_location === true) T = 'SpawnLocation';

    const out = {
        T,
        P: vec3Of(part.position).map(round),
        S: vec3Of(part.scale, [1, 1, 1]).map(round),
        R: eulerOf(part.rotation),
        C: scaled.map(byte).join(''),
        Tr: round(1 - clamp01(num(c.a, 1))),
        Shape: 'Block',
    };

    if (MATERIALS.includes(part.material) && part.material !== DEFAULT_MATERIAL) {
        out.M = part.material;
    }
    if (part.cast_shadow === false) out.Cs = false;
    if (part.anchored === false) out.An = false;
    if (part.can_collide === false) out.Cc = false;
    if (part.baseplate === true) out.Bp = true;
    const textures = texturesFrom(part.textures);
    if (textures) out.Tx = textures;

    return out;
}

function lightFromProject(light) {
    const c = light.color && typeof light.color === 'object' ? light.color : {};
    const rgb = [num(c.r, 1), num(c.g, 1), num(c.b, 1)];
    const unit = rgb.every((n) => n >= 0 && n <= 1);
    const scaled = unit ? rgb : rgb.map((n) => n / 255);
    const name = typeof light.name === 'string' && light.name ? light.name.slice(0, 64) : 'Light';

    return {
        _id: newPartId(),
        N: name,
        P: vec3Of(light.position).map(round),
        R: eulerOf(light.rotation),
        C: scaled.map(byte).join(''),
        I: Math.min(Math.max(num(light.illuminance, DEFAULT_ILLUMINANCE), 0), MAX_ILLUMINANCE),
        Sd: light.shadows_enabled !== false,
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
        const at = raw.group;
        if (Number.isInteger(at) && at >= 0) {
            if (!slotsByGroup.has(at)) slotsByGroup.set(at, []);
            slotsByGroup.get(at).push(parts.length);
        }
        parts.push(partFromProject(raw));
    }

    const listed = Array.isArray(doc.groups) ? doc.groups : [];
    const groups = [...slotsByGroup.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([at, slots]) => ({ name: listed[at]?.name ?? `Group ${at + 1}`, slots }))
        .filter((g) => g.slots.length);

    const lights = (Array.isArray(doc.lights) ? doc.lights : [])
        .filter((l) => l && typeof l === 'object' && !Array.isArray(l))
        .slice(0, MAX_LIGHTS)
        .map(lightFromProject);

    return {
        parts,
        groups,
        lights,
        projectId: /^[a-f0-9]{32}$/i.test(doc.project_id ?? '') ? String(doc.project_id).toLowerCase() : null,
        dropped,
        reshaped: 0,
        recolored: 0,
        capped,
        seen: list.length,
    };
}
