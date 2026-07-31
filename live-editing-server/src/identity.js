import crypto from 'node:crypto';

import { config } from './config.js';

// Laravel signs "<b64url name>.<expiry>" with the secret both processes share.
// Anything that does not verify is not an error: the member just stays anonymous.

const MAX_NAME = 32;

const equal = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);

    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function verifyName(token, secret = config.liveSecret, now = Date.now()) {
    if (typeof token !== 'string' || !secret) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encoded, exp, sig] = parts;

    if (!/^[0-9]{1,15}$/.test(exp) || Number(exp) * 1000 < now) return null;

    const expected = crypto.createHmac('sha256', secret).update(`${encoded}.${exp}`).digest('hex');
    if (!equal(sig, expected)) return null;

    let name;
    try {
        name = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        return null;
    }

    name = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

    return name || null;
}

export function uniqueName(name, taken) {
    if (!taken.has(name)) return name;
    for (let n = 2; n < 100; n++) {
        if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
    }

    return null;
}
