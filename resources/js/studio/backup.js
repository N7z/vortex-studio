const PREFIX = 'studio_backup:';
const INDEX = 'studio_backups';

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
    }
}

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
