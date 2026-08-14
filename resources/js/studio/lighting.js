import {
    DEFAULT_BRIGHTNESS, DEFAULT_ILLUMINANCE, DEFAULT_LIGHTING, FACES as LIGHT_FACES,
    MAX_BRIGHTNESS, MAX_ILLUMINANCE, MAX_INTENSITY, MAX_RANGE,
    cleanLighting, lightingFromSuns, validPointLight, validSpotLight,
} from '../../../live-editing-server/src/lights.js';

export {
    DEFAULT_BRIGHTNESS, DEFAULT_ILLUMINANCE, DEFAULT_LIGHTING, LIGHT_FACES,
    MAX_BRIGHTNESS, MAX_ILLUMINANCE, MAX_INTENSITY, MAX_RANGE,
    cleanLighting, lightingFromSuns, validPointLight, validSpotLight,
};

// The rig has no parts of its own, so the two things you can select in it are named rather than
// carrying ids: the explorer rows and the properties panel both go through these.
export const AMBIENT = 'light:ambient';

export const SUN = 'light:sun';

export const isLightRef = (id) => id === AMBIENT || id === SUN;

// A light on a part is selected through the part that holds it: "light:point:<part id>".
export const partLightRef = (partId, kind) => `light:${kind}:${partId}`;

export const partLightOf = (ref) => {
    if (typeof ref !== 'string') return null;
    const m = /^light:(point|spot):(.+)$/.exec(ref);

    return m ? { kind: m[1], partId: m[2] } : null;
};

export const repairLighting = (lighting) => cleanLighting(lighting) ?? { ...DEFAULT_LIGHTING };

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

export const pointLightOf = (part) => (validPointLight(part?.point_light) ? part.point_light : null);

export const spotLightOf = (part) => (validSpotLight(part?.spot_light) ? part.spot_light : null);

export const hasPartLight = (part) => !!(part?.point_light || part?.spot_light);

// Zero reach means a light that reaches nothing. The renderer reads a distance of zero as "no
// limit", which is the opposite, so it never gets one.
export const rangeToDistance = (range) => (range > 0 ? range : 0.0001);

// A light on a part sits inside it, so with shadows on the part is the first thing its own light
// meets and it shadows everything. Starting the shadow map just outside the part's own corners
// leaves the part out of it, which is what "the light comes from this part" has to mean.
export function shadowNear(size) {
    const [x, y, z] = Array.isArray(size) ? size : [1, 1, 1];

    return Math.max(0.05, Math.hypot(x, y, z) / 2 + 0.05);
}

// Ranges past this are legal but nobody aims with them, so the slider stops here and the box
// carries on to MAX_RANGE.
export const USEFUL_RANGE = 200;

// Which way a spot points, as a direction in the part's own space. A face is the side of the box
// the light shines out of, so Bottom throws light at the floor under it.
export const FACE_DIRECTION = {
    Front: [0, 0, 1],
    Back: [0, 0, -1],
    Top: [0, 1, 0],
    Bottom: [0, -1, 0],
    Left: [-1, 0, 0],
    Right: [1, 0, 0],
};
