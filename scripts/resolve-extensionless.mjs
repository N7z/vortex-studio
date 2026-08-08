// The studio's own modules import each other without a file extension, which the
// bundler resolves and plain Node does not. This hook fills the extension in so a
// test can import them directly, with no bundle step and no extra dependency.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const TRIED = ['.js', '.jsx', '/index.js', '/index.jsx'];

export async function resolve(specifier, context, next) {
    try {
        return await next(specifier, context);
    } catch (err) {
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err;
        for (const ext of TRIED) {
            try {
                return await next(specifier + ext, context);
            } catch { /* try the next one */ }
        }
        throw err;
    }
}

register(pathToFileURL(import.meta.filename));
