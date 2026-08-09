import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.SMOKE_PORT ?? '8899';
const URL = `http://127.0.0.1:${PORT}/`;

const BROWSERS = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);

const browser = BROWSERS.find((p) => {
    try {
        readFileSync(p, { flag: 'r', encoding: 'latin1', length: 1 });
        return true;
    } catch {
        return false;
    }
});

if (!browser) {
    console.error('smoke: no Chrome or Edge found. Set CHROME_PATH to one.');
    process.exit(2);
}

const build = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn('php', ['artisan', 'serve', '--port', PORT], {
    stdio: 'ignore',
    shell: true,
    detached: false,
});

const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);

const reachable = async () => {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(URL);
            if (r.ok) return true;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
};

if (!await reachable()) {
    console.error('smoke: the dev server never answered');
    stop();
    process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'smoke-'));
const run = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${profile}`,
    '--enable-logging=stderr',
    '--log-level=0',
    '--virtual-time-budget=15000',
    '--dump-dom',
    URL,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

stop();
rmSync(profile, { recursive: true, force: true });

const dom = run.stdout ?? '';
const logs = run.stderr ?? '';
const failures = logs
    .split('\n')
    .filter((l) => /CONSOLE/.test(l) && /(Uncaught|Unhandled|TypeError|ReferenceError|SyntaxError)/.test(l))
    .map((l) => l.replace(/^.*CONSOLE:\d+\]\s*/, '').trim());

const root = dom.match(/<div id="root">([\s\S]*?)<\/(?:div|body)>/)?.[1] ?? '';
const mounted = root.trim().length > 0;

for (const f of failures) console.error(`smoke: console -> ${f}`);
if (!mounted) console.error('smoke: #root is empty, the app did not mount');

if (!mounted || failures.length) process.exit(1);
console.log('smoke: the app mounted with no console errors');
