import {
    DEFAULT_ILLUMINANCE, MAX_ILLUMINANCE, MAX_LIGHTS, cleanLights, validLight,
} from '../../../live-editing-server/src/lights.js';
import { newPartId } from './ops.js';

export {
    DEFAULT_ILLUMINANCE, MAX_ILLUMINANCE, MAX_LIGHTS, cleanLights, validLight,
};

// Where the editor's hardcoded sun always stood, and the rotation that points it at
// the origin from there, so a map that never carried lights of its own gets one that
// looks exactly like what was there before. A light shines along its own -Z, the
// same convention every other object in the scene faces.
export const DEFAULT_SUN = {
    N: 'Sun',
    P: [80, 160, 60],
    R: [-69.44, 25.09, 17.53],
    C: 'ffffff',
    I: DEFAULT_ILLUMINANCE,
    Sd: true,
};

export const newLight = (patch = {}) => ({
    ...DEFAULT_SUN, ...patch, P: [...(patch.P ?? DEFAULT_SUN.P)], R: [...(patch.R ?? DEFAULT_SUN.R)], _id: newPartId(),
});

// A light id and a part id are drawn from the same alphabet, so selection prefixes
// one of them rather than hoping they never collide.
export const lightRef = (id) => `light:${id}`;

export const isLightRef = (id) => typeof id === 'string' && id.startsWith('light:');

export const lightIdOf = (ref) => (isLightRef(ref) ? ref.slice(6) : null);

export const repairLights = (lights) => cleanLights(lights) ?? [];
