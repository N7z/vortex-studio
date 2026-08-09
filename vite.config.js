import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
    root: import.meta.dirname,
    define: {
        __APP_VERSION__: JSON.stringify(version),
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
