// How light is quoted spans four or five zeros, and on a straight track everything worth picking is
// crushed into the first pixel. So a light slider runs on a logarithmic track: each stretch of it is
// worth the same proportion rather than the same amount, which is how brightness reads anyway.
export const LOG_STEPS = 1000;

// Where the curve stops being logarithmic and goes straight, so that zero stays reachable.
const KNEE = 10;

export function logToValue(pos, max) {
    const raw = KNEE * Math.expm1((pos / LOG_STEPS) * Math.log1p(max / KNEE));

    return raw <= 0 ? 0 : Number(raw.toPrecision(3));
}

export function valueToLog(value, max) {
    if (!(value > 0)) return 0;

    return Math.round((Math.log1p(value / KNEE) / Math.log1p(max / KNEE)) * LOG_STEPS);
}
