import {
    DEFAULT_ILLUMINANCE, MAX_ILLUMINANCE, MAX_LIGHTS, cleanLights, validLight,
} from '../../../live-editing-server/src/lights.js';
import { newPartId } from './ops.js';

export {
    DEFAULT_ILLUMINANCE, MAX_ILLUMINANCE, MAX_LIGHTS, cleanLights, validLight,
};

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

export const lightRef = (id) => `light:${id}`;

export const isLightRef = (id) => typeof id === 'string' && id.startsWith('light:');

export const lightIdOf = (ref) => (isLightRef(ref) ? ref.slice(6) : null);

export const repairLights = (lights) => cleanLights(lights) ?? [];
