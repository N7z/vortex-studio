export const MATERIALS = ['Plastic', 'Wood', 'Metal', 'Grass', 'Ice', 'Paint'];

export const DEFAULT_MATERIAL = 'Plastic';

export const FACES = ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'];

export const TEXTURES = ['Studs', 'Inlets'];

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

export const castsShadow = (part) => part?.Cs !== false;
export const isAnchored = (part) => part?.An !== false;
export const canCollide = (part) => part?.Cc !== false;
export const isBaseplate = (part) => part?.Bp === true;

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
