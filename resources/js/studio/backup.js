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

export function readBackup(name) {
    try {
        const parts = JSON.parse(localStorage.getItem(PREFIX + name) ?? 'null');
        return Array.isArray(parts) ? parts : null;
    } catch {
        return null;
    }
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
export function writeBackup(name, parts) {
    const body = JSON.stringify(parts);
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
