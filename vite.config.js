import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: import.meta.dirname,
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
