import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

function loadEnvFile() {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.join(here, '..', '.env');
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return;
    }
    for (const line of text.split(/\r?\n/)) {
        if (line.trimStart().startsWith('#')) continue;
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        if (process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
    }
}

loadEnvFile();

const num = (key, fallback) => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

const origins = (process.env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
    port: num('PORT', 8787),
    allowAnyOrigin: origins.includes('*'),
    allowedOrigins: new Set(origins),
    roomGraceMs: num('ROOM_GRACE_SECONDS', 120) * 1000,
    ownerGraceMs: num('OWNER_GRACE_SECONDS', 20) * 1000,
    maxRooms: num('MAX_ROOMS', 200),
    maxMembersPerRoom: num('MAX_MEMBERS_PER_ROOM', 16),
    maxParts: num('MAX_PARTS', 20_000),
    maxMessageBytes: num('MAX_MESSAGE_BYTES', 2_000_000),
    heartbeatMs: num('HEARTBEAT_SECONDS', 25) * 1000,
};

export function originAllowed(origin) {
    if (config.allowAnyOrigin) return true;
    if (!origin) return true;

    return config.allowedOrigins.has(origin);
}
