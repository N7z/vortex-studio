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

export const repairLighting = (lighting) => cleanLighting(lighting) ?? { ...DEFAULT_LIGHTING };

export const DEFAULT_POINT_LIGHT = {
    color: 'ffe9c4',
    intensity: 60000,
    range: 40,
    shadow_maps_enabled: false,
};

export const DEFAULT_SPOT_LIGHT = {
    ...DEFAULT_POINT_LIGHT,
    angle: 35,
    face: 'Bottom',
};

export const pointLightOf = (part) => (validPointLight(part?.point_light) ? part.point_light : null);

export const spotLightOf = (part) => (validSpotLight(part?.spot_light) ? part.spot_light : null);

export const hasPartLight = (part) => !!(part?.point_light || part?.spot_light);

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
