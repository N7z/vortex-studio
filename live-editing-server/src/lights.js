// Lights are map data, like groups: a short list that travels with the document
// rather than a per-part stream, so they are replaced whole instead of patched by
// ops. Shared with the editor the same way ops.js is.

export const MAX_LIGHTS = 32;

// The document calls this illuminance and the desktop Studio writes it in lux. This
// is the value a light it creates itself carries, read off the project in
// VortexStuff's maps/studio-minimal-project.json.
export const DEFAULT_ILLUMINANCE = 10000;

export const MAX_ILLUMINANCE = 200000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

export function validLight(l) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
    for (const k of Object.keys(l)) {
        if (!['_id', 'N', 'P', 'R', 'C', 'I', 'Sd'].includes(k)) return false;
    }
    if (typeof l._id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(l._id)) return false;
    if (typeof l.N !== 'string' || !l.N || l.N.length > 64) return false;
    if (!vec3(l.P) || !vec3(l.R)) return false;
    if (typeof l.C !== 'string' || !/^[0-9a-fA-F]{6}$/.test(l.C)) return false;
    if (!isNum(l.I) || l.I < 0 || l.I > MAX_ILLUMINANCE) return false;
    if (typeof l.Sd !== 'boolean') return false;

    return true;
}

/** The list as stored, or null when it is not one. Ids must be unique within it. */
export function cleanLights(lights) {
    if (lights === undefined || lights === null) return [];
    if (!Array.isArray(lights) || lights.length > MAX_LIGHTS) return null;
    const seen = new Set();
    for (const l of lights) {
        if (!validLight(l) || seen.has(l._id)) return null;
        seen.add(l._id);
    }

    return lights;
}
