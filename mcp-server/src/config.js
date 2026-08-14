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

export const config = {
    studioUrl: (process.env.STUDIO_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    liveUrl: process.env.LIVE_URL ?? 'ws://127.0.0.1:8787',
    origin: process.env.LIVE_ORIGIN ?? process.env.STUDIO_URL ?? 'http://127.0.0.1:8000',
    email: process.env.STUDIO_EMAIL ?? '',
    password: process.env.STUDIO_PASSWORD ?? '',
};
