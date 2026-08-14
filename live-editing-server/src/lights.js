// A map has one lighting rig: an ambient fill and a sun. Anything more local than that is a light
// on a part, which travels with the part rather than living here.
export const DEFAULT_ILLUMINANCE = 10000;

export const MAX_ILLUMINANCE = 200000;

export const DEFAULT_BRIGHTNESS = 80;

export const MAX_BRIGHTNESS = 4000;

export const MAX_INTENSITY = 10000000;

export const MAX_RANGE = 2000;

export const FACES = ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'];

export const DEFAULT_LIGHTING = {
    ambient_color: 'cfe8ff',
    brightness: DEFAULT_BRIGHTNESS,
    sun_color: 'ffffff',
    sun_illuminance: DEFAULT_ILLUMINANCE,
    sun_shadow_maps_enabled: true,
    // The sun needs a direction to cast from and the format it mirrors carries none, so this is
    // ours: the same euler angles, in degrees, that a part uses.
    sun_rotation: [-69.44, 25.09, 17.53],
};

const LIGHTING_KEYS = Object.keys(DEFAULT_LIGHTING);

const POINT_KEYS = ['color', 'intensity', 'range', 'shadow_maps_enabled'];

const SPOT_KEYS = [...POINT_KEYS, 'angle', 'face'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

const hex = (v) => typeof v === 'string' && /^[0-9a-fA-F]{6}$/.test(v);

const within = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

function validPartLight(l, spot) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
    const allowed = spot ? SPOT_KEYS : POINT_KEYS;
    for (const k of Object.keys(l)) if (!allowed.includes(k)) return false;
    if (!hex(l.color)) return false;
    if (!within(l.intensity, 0, MAX_INTENSITY)) return false;
    if (!within(l.range, 0, MAX_RANGE)) return false;
    if (typeof l.shadow_maps_enabled !== 'boolean') return false;
    if (!spot) return true;
    // Degrees, like every other angle in this format, and half the cone rather than the whole of it.
    if (!within(l.angle, 1, 89)) return false;

    return FACES.includes(l.face);
}

export const validPointLight = (l) => validPartLight(l, false);

export const validSpotLight = (l) => validPartLight(l, true);

export function cleanLighting(input) {
    if (input === undefined || input === null) return { ...DEFAULT_LIGHTING };
    // A map written before the rig was one object carries a list of suns. The first one is the sun.
    if (Array.isArray(input)) return lightingFromSuns(input);
    if (typeof input !== 'object') return null;
    for (const k of Object.keys(input)) if (!LIGHTING_KEYS.includes(k)) return null;

    const out = { ...DEFAULT_LIGHTING, ...input };
    if (!hex(out.ambient_color) || !hex(out.sun_color)) return null;
    if (!within(out.brightness, 0, MAX_BRIGHTNESS)) return null;
    if (!within(out.sun_illuminance, 0, MAX_ILLUMINANCE)) return null;
    if (typeof out.sun_shadow_maps_enabled !== 'boolean') return null;
    if (!vec3(out.sun_rotation)) return null;

    return out;
}

// What a list of suns becomes: the first one, since there is only one sun now.
export function lightingFromSuns(suns) {
    const first = Array.isArray(suns) ? suns.find((l) => l && typeof l === 'object') : null;
    if (!first) return { ...DEFAULT_LIGHTING };

    return {
        ...DEFAULT_LIGHTING,
        ...(hex(first.C) ? { sun_color: first.C.toLowerCase() } : {}),
        ...(within(first.I, 0, MAX_ILLUMINANCE) ? { sun_illuminance: first.I } : {}),
        ...(typeof first.Sd === 'boolean' ? { sun_shadow_maps_enabled: first.Sd } : {}),
        ...(vec3(first.R) ? { sun_rotation: [...first.R] } : {}),
    };
}
