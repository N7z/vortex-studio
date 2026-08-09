import crypto from 'node:crypto';

import { config } from './config.js';

const MAX_NAME = 32;

const equal = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);

    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const clean = (name) => (typeof name === 'string'
    ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
    : '');

export function verifyIdentity(token, secret = config.liveSecret, now = Date.now()) {
    if (typeof token !== 'string' || !secret) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encoded, exp, sig] = parts;

    if (!/^[0-9]{1,15}$/.test(exp) || Number(exp) * 1000 < now) return null;

    const expected = crypto.createHmac('sha256', secret).update(`${encoded}.${exp}`).digest('hex');
    if (!equal(sig, expected)) return null;

    let raw;
    try {
        raw = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        return null;
    }

    let claim = null;
    if (raw.startsWith('{')) {
        try {
            claim = JSON.parse(raw);
        } catch {
            return null;
        }
    }

    if (!claim || claim.v !== 2) {
        const name = clean(raw);

        return name ? { userId: null, name, mapName: null, teamId: null, role: null } : null;
    }

    const name = clean(claim.n);
    if (!name) return null;

    return {
        userId: Number.isInteger(claim.u) ? claim.u : null,
        name,
        mapName: typeof claim.m === 'string' ? claim.m : null,
        teamId: Number.isInteger(claim.t) ? claim.t : null,
        role: ['owner', 'editor', 'viewer'].includes(claim.r) ? claim.r : null,
    };
}

export function verifyName(token, secret = config.liveSecret, now = Date.now()) {
    return verifyIdentity(token, secret, now)?.name ?? null;
}

export function uniqueName(name, taken) {
    if (!taken.has(name)) return name;
    for (let n = 2; n < 100; n++) {
        if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
    }

    return null;
}
