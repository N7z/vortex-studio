import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const git = (...args) => {
    try {
        return execFileSync('git', args, {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
};

const [commit = '', commitAt = '', subject = ''] = git('log', '-1', '--format=%h%n%cI%n%s').split('\n');

const contributors = git('shortlog', '-sn', '--no-merges', 'HEAD')
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map(([, commits, name]) => ({ name, commits: Number(commits) }));

const buildInfo = {
    commit,
    commitAt: commitAt || null,
    subject,
    contributors,
    builtAt: new Date().toISOString(),
};

export default defineConfig({
    root: import.meta.dirname,
    define: {
        __APP_VERSION__: JSON.stringify(version),
        __BUILD_INFO__: JSON.stringify(buildInfo),
    },
    plugins: [
        laravel({
            input: [
                'resources/css/app.css', 'resources/js/app.jsx',
                'resources/css/admin.css', 'resources/js/admin.jsx',
                'resources/js/scan.js',
            ],
            refresh: true,
        }),
        react(),
    ],
    server: {
        host: '127.0.0.1',
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
