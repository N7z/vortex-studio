// Every save is mirrored into localStorage so a map survives losing the server copy:
// the anonymous token cookie expiring, the 24h TTL, a failed request, another browser
// profile. The server stays the source of truth; this is only a safety net.

const PREFIX = 'studio_backup:';
const INDEX = 'studio_backups';

// Listing must stay cheap, so the metadata lives in one small index entry instead of
// being recovered by parsing every stored map.
function readIndex() {
    try {
        const raw = JSON.parse(localStorage.getItem(INDEX) ?? '{}');
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
        return {};
    }
}

function writeIndex(index) {
    try {
        localStorage.setItem(INDEX, JSON.stringify(index));
    } catch {
        // Nothing useful to do: the backup itself is already written.
    }
}

/** Backups newest first: `[{ name, savedAt, count }]`. */
export function listBackups() {
    return Object.entries(readIndex())
        .map(([name, meta]) => ({
            name,
            savedAt: Number(meta?.savedAt) || 0,
            count: Number(meta?.count) || 0,
        }))
        .sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * The mirrored document: `{ parts, groups, lights, projectId }`. What is stored is
 * whatever the save sent, which used to be a bare array of parts and is now the
 * whole body, so both shapes are read.
 */
export function readBackup(name) {
    let doc;
    try {
        doc = JSON.parse(localStorage.getItem(PREFIX + name) ?? 'null');
    } catch {
        return null;
    }
    if (Array.isArray(doc)) return { parts: doc, groups: [], lights: [], projectId: null };
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.parts)) return null;

    return {
        parts: doc.parts,
        groups: Array.isArray(doc.groups) ? doc.groups : [],
        lights: Array.isArray(doc.lights) ? doc.lights : [],
        projectId: doc.project_id ?? null,
    };
}

export function deleteBackup(name) {
    try {
        localStorage.removeItem(PREFIX + name);
    } catch { /* ignore */ }
    const index = readIndex();
    delete index[name];
    writeIndex(index);
}

/**
 * Mirror one map. Returns false only if it could not be stored at all. A full quota
 * first evicts the oldest *other* backups, since the map being saved now is the one
 * the user is actually working on.
 */
// Browsers give an origin about 5 MB in total, so a map past this can never fit and
// trying would only evict every other backup on the way to failing.
const TOO_BIG = 4 * 1024 * 1024;

export function writeBackup(name, parts, body = null) {
    body ??= JSON.stringify(parts);
    if (body.length > TOO_BIG) return false;
    const index = readIndex();
    let stale = listBackups().filter((b) => b.name !== name).reverse();

    for (;;) {
        try {
            localStorage.setItem(PREFIX + name, body);
            index[name] = { savedAt: Date.now(), count: parts.length };
            writeIndex(index);
            return true;
        } catch {
            const victim = stale.shift();
            if (!victim) return false;
            try {
                localStorage.removeItem(PREFIX + victim.name);
            } catch { /* ignore */ }
            delete index[victim.name];
        }
    }
}
