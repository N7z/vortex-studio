// The per-part properties the official Studio document carries and the editor did
// not model: material, the three behaviour toggles, the baseplate flag and the
// per-face textures. All of them are optional on the internal part, so every stored
// map, backup and undo entry from before them stays valid: absent means the default.

export const MATERIALS = ['Plastic', 'Wood', 'Metal', 'Grass', 'Ice', 'Paint'];

export const DEFAULT_MATERIAL = 'Plastic';

// The document's own face names, in the order the panel lists them. The viewport's
// box is built to match: +X Right, -X Left, +Z Front, -Z Back, +Y Top, -Y Bottom.
export const FACES = ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'];

export const TEXTURES = ['Studs', 'Inlets'];

// The desktop app ships a full albedo/normal/orm set per material. Reproducing the
// look well enough to tell Metal from Wood only needs the two scalars.
const LOOK = {
    Plastic: { roughness: 0.55, metalness: 0 },
    Wood: { roughness: 0.85, metalness: 0 },
    Metal: { roughness: 0.32, metalness: 0.85 },
    Grass: { roughness: 0.95, metalness: 0 },
    Ice: { roughness: 0.08, metalness: 0.1 },
    Paint: { roughness: 0.28, metalness: 0 },
};

export const materialOf = (part) => (MATERIALS.includes(part?.M) ? part.M : DEFAULT_MATERIAL);

export const lookOf = (name) => LOOK[name] ?? LOOK[DEFAULT_MATERIAL];

// The toggles default to on, which is what the official exporter writes for a part
// that was never touched, so an absent key and an explicit `true` mean the same.
export const castsShadow = (part) => part?.Cs !== false;
export const isAnchored = (part) => part?.An !== false;
export const canCollide = (part) => part?.Cc !== false;
export const isBaseplate = (part) => part?.Bp === true;

/**
 * Textures live on the part as `{ Top: 'Studs' }` rather than the document's list of
 * `{face, kind}`: a map cannot name the same face twice, which is an invariant the
 * list shape leaves open. Unknown faces and kinds are dropped rather than repaired.
 */
export function cleanTextures(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out = {};
    for (const [face, kind] of Object.entries(value)) {
        if (FACES.includes(face) && TEXTURES.includes(kind)) out[face] = kind;
    }

    return out;
}

export const validTextures = (value) => {
    const clean = cleanTextures(value);

    return !!clean && Object.keys(clean).length === Object.keys(value).length;
};

export const texturesOf = (part) => cleanTextures(part?.Tx) ?? {};
