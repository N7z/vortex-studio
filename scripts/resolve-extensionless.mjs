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
