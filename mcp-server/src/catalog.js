
import { MATERIALS, FACES, TEXTURES } from '../../live-editing-server/src/ops.js';
import { rng } from './geom.js';

export { MATERIALS, FACES, TEXTURES };

export const PART_TYPES = ['Part', 'SpawnLocation', 'ShirtPad', 'Truss'];

export const PLAY = {
    bodyHeight: 5,
    halfWidth: 1,
    walkSpeed: 16,
    jumpVelocity: 50,
    gravity: -196.2,
    stepHeight: 2,
    slopeLimitDegrees: 45,
    voidY: -500,
};

export const MAX_JUMP_HEIGHT = (PLAY.jumpVelocity ** 2) / (2 * Math.abs(PLAY.gravity));

export const DEFAULT_POINT_LIGHT = {
    color: 'ffe9c4',
    intensity: 3000,
    range: 40,
    shadow_maps_enabled: false,
};

export const DEFAULT_SPOT_LIGHT = {
    ...DEFAULT_POINT_LIGHT,
    intensity: 6000,
    range: 60,
    angle: 35,
    face: 'Bottom',
};

export const LIMITS = {
    maxParts: 60_000,
    maxGroups: 2_000,
    maxIlluminance: 200_000,
    maxBrightness: 4_000,
    maxIntensity: 10_000_000,
    maxRange: 2_000,
    maxBytes: 8_000_000,
};

export const MATERIAL_INFO = {
    Plastic: {
        look: 'smooth, slightly matte, the neutral default',
        use: 'generic structure, painted surfaces, anything that should read as built',
        walkable: true,
    },
    Wood: {
        look: 'rough and warm, visible grain',
        use: 'floors, doors, crates, beams, furniture, bridges',
        walkable: true,
    },
    Metal: {
        look: 'reflective, low roughness, high metalness',
        use: 'bars, grates, machinery, chains, weapons, reinforcement',
        walkable: true,
    },
    Grass: {
        look: 'very rough, matte, organic',
        use: 'outdoor ground, courtyards, overgrowth, natural terrain',
        walkable: true,
    },
    Ice: {
        look: 'near mirror finish, slight metalness, reads as glass or ice',
        use: 'water, ice, windows, crystals. Pair with Tr for glass',
        walkable: true,
    },
    Paint: {
        look: 'clean semi-gloss',
        use: 'banners, signs, decoration meant to read as coloured, not textured',
        walkable: true,
    },
};

export const PART_TYPE_INFO = {
    Part: {
        purpose: 'the ordinary building block; everything structural is one of these',
        gameplay: 'collides and is solid unless Cc is set false',
    },
    SpawnLocation: {
        purpose: 'where the character appears on Play. A map needs at least one',
        gameplay: 'solid like a Part, and marks the spawn point. Put its top at the walkable floor level',
    },
    Truss: {
        purpose: 'an open lattice cage rather than a solid box',
        gameplay: 'reads as bars, scaffolding or a prison grate; still collides',
    },
    ShirtPad: {
        purpose: 'a block that displays the player shirt texture on its sides',
        gameplay: 'decorative, rarely useful for level geometry',
    },
};

export const FIELD_INFO = {
    T: 'part type, one of Part / SpawnLocation / Truss / ShirtPad',
    P: 'CENTRE position [x, y, z]. Y is up',
    S: 'full size [x, y, z], not a half extent',
    R: 'rotation [x, y, z] in DEGREES, XYZ euler order',
    C: 'colour as a 6 digit hex string with no leading #',
    Tr: 'transparency 0..1, where 1 is invisible. Use ~0.6 with Ice for glass',
    M: 'material, one of Plastic / Wood / Metal / Grass / Ice / Paint',
    Tx: 'per face texture, e.g. { "Top": "Studs" }. Faces: Front/Back/Top/Bottom/Left/Right',
    Cs: 'casts shadow, default true',
    An: 'anchored, default true. Set false and the part falls when you press Play',
    Cc: 'can collide, default true. Set false for decoration the player should walk through',
    Bp: 'baseplate flag, used for the big ground slab',
};

const hex = (c) => String(c).replace(/^#/, '').toLowerCase();

const box = (x, y, z, sx, sy, sz, fields) => ({
    T: 'Part',
    P: [x, y, z],
    S: [sx, sy, sz],
    R: [0, 0, 0],
    ...fields,
});

function yawParts(parts, yaw, origin) {
    const turn = ((yaw % 360) + 360) % 360;
    if (!turn) return parts;
    const rad = (turn * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const quarter = turn % 90 === 0;

    return parts.map((p) => {
        const dx = p.P[0] - origin[0];
        const dz = p.P[2] - origin[2];
        const x = origin[0] + dx * cos + dz * sin;
        const z = origin[2] - dx * sin + dz * cos;
        const swap = quarter && turn % 180 === 90;

        return {
            ...p,
            P: [x, p.P[1], z],
            S: swap ? [p.S[2], p.S[1], p.S[0]] : [...p.S],
            R: quarter ? [...p.R] : [p.R[0], p.R[1] + turn, p.R[2]],
        };
    });
}

export const PROPS = {
    crate: {
        name: 'Wooden crate',
        category: 'container',
        size: [4, 4, 4],
        collides: true,
        walkable: true,
        decorative: false,
        purpose: 'stackable clutter that also works as a step or cover',
        terrain: ['dungeon', 'storeroom', 'ship', 'market', 'interior'],
        variants: ['crate', 'crate_small'],
        build: (o) => {
            const s = o.variant === 'crate_small' ? 2.5 : 4;
            const wood = { M: 'Wood', C: hex(o.color ?? '8a5a2b') };

            return [
                box(o.x, o.y + s / 2, o.z, s, s, s, wood),
                box(o.x, o.y + s / 2, o.z, s * 1.04, s * 0.16, s * 1.04,
                    { M: 'Wood', C: hex(o.color ?? '6b4420'), Cc: false }),
            ];
        },
    },
    barrel: {
        name: 'Barrel',
        category: 'container',
        size: [3.4, 4.4, 3.4],
        collides: true,
        walkable: true,
        decorative: false,
        purpose: 'clustered clutter for cellars, taverns and storerooms',
        terrain: ['dungeon', 'tavern', 'storeroom', 'ship', 'interior'],
        build: (o) => {
            const wood = { M: 'Wood', C: hex(o.color ?? '7a4f26') };
            const band = { M: 'Metal', C: '4a4a50', Cc: false };

            return [
                box(o.x, o.y + 2.2, o.z, 3.4, 4.4, 3.4, wood),
                box(o.x, o.y + 0.9, o.z, 3.6, 0.4, 3.6, band),
                box(o.x, o.y + 3.5, o.z, 3.6, 0.4, 3.6, band),
            ];
        },
    },
    pillar: {
        name: 'Stone pillar',
        category: 'structure',
        size: [4, 12, 4],
        collides: true,
        walkable: false,
        decorative: false,
        purpose: 'breaks up large halls, carries the eye upward, marks a rhythm along a wall',
        terrain: ['dungeon', 'hall', 'temple', 'ruins'],
        build: (o) => {
            const h = o.height ?? 12;
            const stone = { M: o.material ?? 'Plastic', C: hex(o.color ?? '7d7a74') };

            return [
                box(o.x, o.y + 0.6, o.z, 5, 1.2, 5, stone),
                box(o.x, o.y + h / 2, o.z, 3.6, h, 3.6, stone),
                box(o.x, o.y + h - 0.6, o.z, 5, 1.2, 5, stone),
            ];
        },
    },
    torch: {
        name: 'Wall torch',
        category: 'lighting',
        size: [1, 3, 1.6],
        collides: false,
        walkable: false,
        decorative: true,
        purpose: 'the main way to light a dungeon wall and give it rhythm. Pair with add_lighting for real light',
        terrain: ['dungeon', 'castle', 'cave', 'interior'],
        orientation: 'faces away from the wall it is mounted on; pass yaw',
        build: (o) => [
            box(o.x, o.y + 1, o.z, 0.5, 2, 0.5, { M: 'Wood', C: '4a3520', Cc: false }),
            box(o.x, o.y + 2.4, o.z, 1.1, 1.4, 1.1,
                { M: 'Paint', C: hex(o.color ?? 'ff9a3c'), Cc: false, Cs: false, Tr: 0.15 }),
        ],
    },
    brazier: {
        name: 'Standing brazier',
        category: 'lighting',
        size: [3, 5, 3],
        collides: true,
        walkable: false,
        decorative: true,
        purpose: 'a floor light source and a strong focal point in the middle of a hall',
        terrain: ['dungeon', 'temple', 'hall', 'ruins'],
        build: (o) => [
            box(o.x, o.y + 0.3, o.z, 2.6, 0.6, 2.6, { M: 'Metal', C: '3d3d42' }),
            box(o.x, o.y + 1.6, o.z, 0.7, 2.6, 0.7, { M: 'Metal', C: '3d3d42' }),
            box(o.x, o.y + 3.4, o.z, 3, 1.4, 3, { M: 'Metal', C: '4a4a50' }),
            box(o.x, o.y + 4.3, o.z, 2.4, 1, 2.4,
                { M: 'Paint', C: hex(o.color ?? 'ff8a2c'), Cc: false, Cs: false, Tr: 0.2 }),
        ],
    },
    table: {
        name: 'Table',
        category: 'furniture',
        size: [8, 4, 4],
        collides: true,
        walkable: true,
        decorative: false,
        purpose: 'anchors a room as somewhere people use; put props on top of it',
        terrain: ['tavern', 'interior', 'dungeon', 'library'],
        build: (o) => {
            const w = o.width ?? 8;
            const d = o.depth ?? 4;
            const wood = { M: 'Wood', C: hex(o.color ?? '6f4a25') };
            const leg = (dx, dz) => box(o.x + dx, o.y + 1.8, o.z + dz, 0.6, 3.6, 0.6, wood);

            return [
                box(o.x, o.y + 3.8, o.z, w, 0.4, d, wood),
                leg(-w / 2 + 0.6, -d / 2 + 0.6), leg(w / 2 - 0.6, -d / 2 + 0.6),
                leg(-w / 2 + 0.6, d / 2 - 0.6), leg(w / 2 - 0.6, d / 2 - 0.6),
            ];
        },
    },
    bench: {
        name: 'Bench',
        category: 'furniture',
        size: [6, 2, 2],
        collides: true,
        walkable: true,
        decorative: false,
        purpose: 'pairs with a table, or lines the wall of a cell or hall',
        terrain: ['tavern', 'interior', 'prison', 'temple'],
        build: (o) => {
            const w = o.width ?? 6;
            const wood = { M: 'Wood', C: hex(o.color ?? '6f4a25') };

            return [
                box(o.x, o.y + 1.8, o.z, w, 0.4, 2, wood),
                box(o.x - w / 2 + 0.5, o.y + 0.9, o.z, 0.5, 1.8, 1.8, wood),
                box(o.x + w / 2 - 0.5, o.y + 0.9, o.z, 0.5, 1.8, 1.8, wood),
            ];
        },
    },
    chest: {
        name: 'Treasure chest',
        category: 'gameplay',
        size: [4, 3, 2.6],
        collides: true,
        walkable: true,
        decorative: false,
        purpose: 'a reward marker. Reads as the point of a room, so use it sparingly',
        terrain: ['dungeon', 'vault', 'interior'],
        build: (o) => [
            box(o.x, o.y + 1, o.z, 4, 2, 2.6, { M: 'Wood', C: hex(o.color ?? '5d3a1a') }),
            box(o.x, o.y + 2.3, o.z, 4.1, 0.8, 2.7, { M: 'Wood', C: '4a2e14' }),
            box(o.x, o.y + 1.6, o.z + 1.35, 1.2, 1, 0.3, { M: 'Metal', C: 'c8a13a', Cc: false }),
        ],
    },
    bookshelf: {
        name: 'Bookshelf',
        category: 'furniture',
        size: [6, 10, 2],
        collides: true,
        walkable: false,
        decorative: false,
        purpose: 'fills a wall and instantly reads as a library or study',
        terrain: ['library', 'interior', 'tower'],
        orientation: 'back against a wall; pass yaw so the shelves face the room',
        build: (o) => {
            const wood = { M: 'Wood', C: hex(o.color ?? '5a3a1c') };
            const parts = [
                box(o.x, o.y + 5, o.z - 0.8, 6, 10, 0.4, wood),
                box(o.x - 2.8, o.y + 5, o.z, 0.4, 10, 2, wood),
                box(o.x + 2.8, o.y + 5, o.z, 0.4, 10, 2, wood),
            ];
            const tone = ['8c3b3b', '3b5a8c', '3b8c55', '8c7a3b'];
            for (let i = 0; i < 4; i++) {
                const y = o.y + 1.4 + i * 2.4;
                parts.push(box(o.x, y, o.z, 5.6, 0.3, 1.8, wood));
                parts.push(box(o.x, y + 1, o.z, 5, 1.6, 1.2,
                    { M: 'Paint', C: tone[i % tone.length], Cc: false }));
            }

            return parts;
        },
    },
    bars: {
        name: 'Iron bars',
        category: 'structure',
        size: [8, 10, 1],
        collides: true,
        walkable: false,
        decorative: false,
        purpose: 'the wall of a prison cell, or a grate over an opening. Uses the Truss part type',
        terrain: ['prison', 'dungeon'],
        orientation: 'spans along its width; pass yaw to run it along Z instead',
        build: (o) => {
            const w = o.width ?? 8;
            const h = o.height ?? 10;

            return [{
                T: 'Truss',
                P: [o.x, o.y + h / 2, o.z],
                S: [w, h, 1],
                R: [0, 0, 0],
                M: 'Metal',
                C: hex(o.color ?? '43434a'),
            }];
        },
    },
    cage: {
        name: 'Hanging cage',
        category: 'decoration',
        size: [4, 6, 4],
        collides: true,
        walkable: false,
        decorative: true,
        purpose: 'grim vertical detail for a prison; hangs from the ceiling',
        terrain: ['prison', 'dungeon'],
        build: (o) => {
            const drop = o.height ?? 6;

            return [
                box(o.x, o.y - drop / 2, o.z, 0.3, drop, 0.3, { M: 'Metal', C: '3a3a40', Cc: false }),
                {
                    T: 'Truss',
                    P: [o.x, o.y - drop - 2, o.z],
                    S: [4, 4, 4],
                    R: [0, 0, 0],
                    M: 'Metal',
                    C: hex(o.color ?? '43434a'),
                },
            ];
        },
    },
    rubble: {
        name: 'Rubble pile',
        category: 'decoration',
        size: [5, 2, 5],
        collides: true,
        walkable: true,
        decorative: true,
        purpose: 'breaks up an empty floor and sells a place as old or ruined',
        terrain: ['dungeon', 'ruins', 'cave', 'outdoor'],
        build: (o) => {
            const next = rng(o.seed ?? 1);
            const stone = hex(o.color ?? '6e6b66');
            const out = [];
            for (let i = 0; i < 5; i++) {
                const s = 0.8 + next() * 1.6;
                out.push(box(
                    o.x + (next() - 0.5) * 4,
                    o.y + s / 2,
                    o.z + (next() - 0.5) * 4,
                    s, s * 0.7, s * (0.7 + next() * 0.6),
                    { M: o.material ?? 'Plastic', C: stone, R: [0, next() * 90, 0] },
                ));
            }

            return out;
        },
    },
    stalagmite: {
        name: 'Stalagmite',
        category: 'decoration',
        size: [2.5, 7, 2.5],
        collides: true,
        walkable: false,
        decorative: true,
        purpose: 'natural cave detail; cluster them in threes at different heights',
        terrain: ['cave', 'dungeon', 'ruins'],
        build: (o) => {
            const h = o.height ?? 7;
            const stone = { M: o.material ?? 'Plastic', C: hex(o.color ?? '6a6660') };
            const out = [];
            const steps = 4;
            for (let i = 0; i < steps; i++) {
                const t = i / steps;
                const w = 2.5 * (1 - t * 0.75);
                out.push(box(o.x, o.y + (h * (t + 0.5 / steps)), o.z, w, h / steps, w, stone));
            }

            return out;
        },
    },
    banner: {
        name: 'Wall banner',
        category: 'decoration',
        size: [3, 8, 0.3],
        collides: false,
        walkable: false,
        decorative: true,
        purpose: 'colour on a big blank wall; the cheapest way to stop a hall looking grey',
        terrain: ['castle', 'hall', 'temple', 'interior'],
        orientation: 'hangs flat against a wall; pass yaw to match the wall',
        build: (o) => {
            const h = o.height ?? 8;

            return [
                box(o.x, o.y + h, o.z, 3.6, 0.3, 0.5, { M: 'Metal', C: '4a4a50', Cc: false }),
                box(o.x, o.y + h / 2, o.z, 3, h, 0.2,
                    { M: 'Paint', C: hex(o.color ?? '8c2b2b'), Cc: false }),
            ];
        },
    },
    altar: {
        name: 'Altar',
        category: 'gameplay',
        size: [6, 4, 4],
        collides: true,
        walkable: true,
        decorative: false,
        purpose: 'a strong focal point. Put it on a raised dais at the end of a sightline',
        terrain: ['temple', 'dungeon', 'ruins'],
        build: (o) => [
            box(o.x, o.y + 0.5, o.z, 7, 1, 5, { M: 'Plastic', C: hex(o.color ?? '8d8a83') }),
            box(o.x, o.y + 2.2, o.z, 5, 2.4, 3, { M: 'Plastic', C: hex(o.color ?? '9b978f') }),
            box(o.x, o.y + 3.7, o.z, 6.4, 0.6, 4.4, { M: 'Plastic', C: hex(o.color ?? '8d8a83') }),
        ],
    },
    chandelier: {
        name: 'Chandelier',
        category: 'lighting',
        size: [6, 5, 6],
        collides: false,
        walkable: false,
        decorative: true,
        purpose: 'lights and decorates the empty air of a tall hall. Anchor it to the ceiling height',
        terrain: ['castle', 'hall', 'tavern', 'interior'],
        build: (o) => {
            const drop = o.height ?? 4;
            const out = [
                box(o.x, o.y - drop / 2, o.z, 0.3, drop, 0.3, { M: 'Metal', C: '3a3a40', Cc: false }),
                box(o.x, o.y - drop, o.z, 6, 0.5, 0.5, { M: 'Metal', C: '4a4a50', Cc: false }),
                box(o.x, o.y - drop, o.z, 0.5, 0.5, 6, { M: 'Metal', C: '4a4a50', Cc: false }),
            ];
            for (const [dx, dz] of [[-2.6, 0], [2.6, 0], [0, -2.6], [0, 2.6]]) {
                out.push(box(o.x + dx, o.y - drop + 0.8, o.z + dz, 0.8, 1.4, 0.8,
                    { M: 'Paint', C: hex(o.color ?? 'ffb347'), Cc: false, Cs: false, Tr: 0.2 }));
            }

            return out;
        },
    },
    well: {
        name: 'Stone well',
        category: 'decoration',
        size: [7, 9, 7],
        collides: true,
        walkable: false,
        decorative: true,
        purpose: 'a courtyard centrepiece with real vertical interest',
        terrain: ['outdoor', 'courtyard', 'village', 'ruins'],
        build: (o) => {
            const stone = { M: 'Plastic', C: hex(o.color ?? '77746e') };
            const out = [];
            for (const [dx, dz, sx, sz] of [[0, -3, 7, 1], [0, 3, 7, 1], [-3, 0, 1, 7], [3, 0, 1, 7]]) {
                out.push(box(o.x + dx, o.y + 1.5, o.z + dz, sx, 3, sz, stone));
            }
            out.push(box(o.x, o.y + 0.2, o.z, 5, 0.4, 5, { M: 'Ice', C: '2b4f6b', Tr: 0.35 }));
            out.push(box(o.x - 3, o.y + 5.5, o.z, 0.6, 5, 0.6, { M: 'Wood', C: '5a3a1c' }));
            out.push(box(o.x + 3, o.y + 5.5, o.z, 0.6, 5, 0.6, { M: 'Wood', C: '5a3a1c' }));
            out.push(box(o.x, o.y + 8.4, o.z, 8, 0.6, 8, { M: 'Wood', C: '6b4420' }));

            return out;
        },
    },
    tree: {
        name: 'Tree',
        category: 'nature',
        size: [8, 16, 8],
        collides: true,
        walkable: false,
        decorative: true,
        purpose: 'outdoor mass and shade; vary the height so a group does not read as a grid',
        terrain: ['outdoor', 'forest', 'courtyard', 'village'],
        build: (o) => {
            const h = o.height ?? 16;
            const trunk = { M: 'Wood', C: hex('4a3218') };
            const leaf = { M: 'Grass', C: hex(o.color ?? '3f6b32') };

            return [
                box(o.x, o.y + h * 0.35, o.z, 2, h * 0.7, 2, trunk),
                box(o.x, o.y + h * 0.75, o.z, 8, h * 0.35, 8, leaf),
                box(o.x, o.y + h * 0.95, o.z, 5, h * 0.2, 5, leaf),
            ];
        },
    },
    rock: {
        name: 'Boulder',
        category: 'nature',
        size: [5, 4, 5],
        collides: true,
        walkable: false,
        decorative: true,
        purpose: 'outdoor clutter and silhouette breaks along a path edge',
        terrain: ['outdoor', 'cave', 'ruins', 'forest'],
        build: (o) => {
            const next = rng(o.seed ?? 7);
            const stone = { M: o.material ?? 'Plastic', C: hex(o.color ?? '6e6b66') };

            return [
                box(o.x, o.y + 1.6, o.z, 5, 3.2, 4.4, { ...stone, R: [0, next() * 90, 0] }),
                box(o.x + 1, o.y + 0.8, o.z - 1, 2.6, 1.6, 2.4, { ...stone, R: [0, next() * 90, 0] }),
            ];
        },
    },
    doorframe: {
        name: 'Door frame',
        category: 'structure',
        size: [8, 12, 2],
        collides: true,
        walkable: false,
        decorative: false,
        purpose: 'dresses a doorway opening so it reads as built rather than as a hole',
        terrain: ['dungeon', 'castle', 'interior', 'temple'],
        orientation: 'spans along its width; pass yaw to match the wall',
        build: (o) => {
            const w = o.width ?? 8;
            const h = o.height ?? 12;
            const stone = { M: o.material ?? 'Plastic', C: hex(o.color ?? '85817a') };

            return [
                box(o.x - w / 2 - 0.5, o.y + h / 2, o.z, 1, h, 2, stone),
                box(o.x + w / 2 + 0.5, o.y + h / 2, o.z, 1, h, 2, stone),
                box(o.x, o.y + h + 0.5, o.z, w + 3, 1, 2, stone),
            ];
        },
    },
};

export const PROP_IDS = Object.keys(PROPS);

export function propSummary(id) {
    const p = PROPS[id];
    if (!p) return null;

    return {
        id,
        name: p.name,
        category: p.category,
        size: p.size,
        collides: p.collides,
        walkable: p.walkable,
        decorative: p.decorative,
        purpose: p.purpose,
        terrain: p.terrain,
        orientation: p.orientation ?? 'no preferred facing',
        variants: p.variants ?? [id],
    };
}

export function buildProp(id, options) {
    const prop = PROPS[id];
    if (!prop) throw new Error(`unknown prop "${id}". Call get_available_assets to see the list.`);

    const parts = prop.build({ ...options, variant: options.variant ?? id });
    const yaw = options.yaw ?? 0;
    const turned = yaw ? yawParts(parts, yaw, [options.x, options.y, options.z]) : parts;
    const scale = options.scale ?? 1;
    if (scale === 1) return turned;

    return turned.map((p) => ({
        ...p,
        P: [
            options.x + (p.P[0] - options.x) * scale,
            options.y + (p.P[1] - options.y) * scale,
            options.z + (p.P[2] - options.z) * scale,
        ],
        S: p.S.map((v) => v * scale),
    }));
}

export const PALETTES = {
    dungeon: {
        description: 'cold damp stone, iron and torchlight',
        floor: { M: 'Plastic', C: '5f5c57' },
        wall: { M: 'Plastic', C: '6e6b66' },
        trim: { M: 'Plastic', C: '4a4844' },
        accent: { M: 'Metal', C: '43434a' },
        light: 'ff9a3c',
    },
    castle: {
        description: 'dressed sandstone, timber and heraldic colour',
        floor: { M: 'Plastic', C: '9a9184' },
        wall: { M: 'Plastic', C: 'aba294' },
        trim: { M: 'Wood', C: '6f4a25' },
        accent: { M: 'Paint', C: '8c2b2b' },
        light: 'ffd9a0',
    },
    cave: {
        description: 'raw uneven rock, almost no straight lines',
        floor: { M: 'Plastic', C: '4f4c47' },
        wall: { M: 'Plastic', C: '5a5751' },
        trim: { M: 'Plastic', C: '3d3b37' },
        accent: { M: 'Ice', C: '4a7fa5' },
        light: '9fd0ff',
    },
    outdoor: {
        description: 'grass, earth and stone paths',
        floor: { M: 'Grass', C: '4a7c3a' },
        wall: { M: 'Plastic', C: '7d7a74' },
        trim: { M: 'Wood', C: '5a3a1c' },
        accent: { M: 'Ice', C: '2b6f9e' },
        light: 'ffffff',
    },
    interior: {
        description: 'warm timber and plaster rooms',
        floor: { M: 'Wood', C: '6f4a25' },
        wall: { M: 'Plastic', C: 'c4b8a4' },
        trim: { M: 'Wood', C: '4a3218' },
        accent: { M: 'Paint', C: '3b5a8c' },
        light: 'ffd9a0',
    },
};

export const PALETTE_IDS = Object.keys(PALETTES);

export function palette(name) {
    return PALETTES[name] ?? null;
}
