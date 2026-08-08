let csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? '';

// Sign-in and sign-out rotate the session, so every reply carries a fresh token.
async function account(path, body) {
    const r = await fetch(`/account${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (data.csrf) csrf = data.csrf;
    if (!r.ok) {
        const first = data.errors && Object.values(data.errors)[0]?.[0];
        throw new Error(first || data.message || 'that did not work');
    }
    return data;
}

export const loadAccount = () => account('/');
// The map is named so the token can carry what the caller may do to it. Joining by
// code names nothing, and the token then proves the display name only.
export const liveToken = (map = null, team = null) => {
    const q = new URLSearchParams();
    if (map) q.set('map', map);
    if (team != null) q.set('team', String(team));

    return account(`/live-token${q.toString() ? `?${q}` : ''}`)
        .then((d) => d.token ?? null).catch(() => null);
};
export const register = (fields) => account('/register', fields);
export const login = (fields) => account('/login', fields);
export const logout = () => account('/logout', {});

export async function listMaps() {
    const r = await fetch('/api/maps');
    if (!r.ok) throw new Error('failed to list maps');
    return r.json();
}

/** Any map by id, for an admin opening someone else's. 404 for everyone else. */
export async function loadMapAsAdmin(id) {
    const r = await fetch(`/admin/maps/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('that map could not be opened');
    return r.json();
}

const mapUrl = (name, team) => `/api/maps/${encodeURIComponent(name)}${team != null ? `?team=${team}` : ''}`;

// A bare array is what an older server returns; both shapes stay readable.
export async function loadMap(name, team = null) {
    const r = await fetch(mapUrl(name, team));
    if (!r.ok) throw new Error(`failed to load ${name}`);
    const d = await r.json();

    return Array.isArray(d)
        ? { parts: d, groups: [], lights: [], projectId: null, version: 0 }
        : {
            parts: d.parts ?? [],
            groups: d.groups ?? [],
            lights: d.lights ?? [],
            projectId: d.project_id ?? null,
            version: d.version ?? 0,
        };
}

/** Throws a StaleError when somebody else saved since this copy was loaded. */
export class StaleError extends Error {
    constructor(version) {
        super('someone else saved this map');
        this.stale = true;
        this.version = version;
    }
}

export class DestructiveError extends Error {
    constructor(was, now) {
        super('this save removes most of the map');
        this.destructive = true;
        this.was = was;
        this.now = now;
    }
}

// PHP discards a request body over post_max_size (8 MB by default) before any code
// sees it, and a big map is mostly repeated key names, so it gzips to about a fifth.
// Sent under our own header: nginx and Cloudflare do not touch request bodies, but
// they do act on Content-Encoding.
const GZIP_OVER = 512 * 1024;

const gzip = async (text) => new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
).arrayBuffer();

/** The JSON a save would send, so a caller can size it without building it twice. */
export const saveBody = (parts, groups, version, lights = [], projectId = null) => JSON.stringify({
    parts, groups, lights, project_id: projectId, version,
});

export async function saveMap(
    name, parts, groups, team = null, version = null, body = null, confirmed = false,
    lights = [], projectId = null,
) {
    const text = body ?? saveBody(parts, groups, version, lights, projectId);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf };
    if (confirmed) headers['X-Confirm-Destructive'] = '1';
    let payload = text;
    if (text.length > GZIP_OVER && typeof CompressionStream === 'function') {
        payload = await gzip(text);
        headers['X-Body-Encoding'] = 'gzip';
    }
    const r = await fetch(mapUrl(name, team), {
        method: 'PUT',
        headers,
        body: payload,
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 409) throw new StaleError(d.version ?? null);
    if (d.error === 'destructive') throw new DestructiveError(d.was ?? 0, d.now ?? 0);
    if (!r.ok) throw new Error(d.message || `failed to save ${name}`);

    return d;
}

const historyUrl = (name, team, suffix = '') =>
    `/api/maps/${encodeURIComponent(name)}/history${suffix}${team != null ? `?team=${team}` : ''}`;

async function json(url, options = {}) {
    const r = await fetch(url, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'that did not work');

    return d;
}

export const mapHistory = (name, team) => json(historyUrl(name, team));
export const pinVersion = (name, team) => json(historyUrl(name, team), { method: 'POST' });
export const loadVersion = (name, team, id) => json(historyUrl(name, team, `/${id}`));
export const restoreVersion = (name, team, id) =>
    json(historyUrl(name, team, `/${id}/restore`), { method: 'POST' });

export const listTrash = () => json('/api/maps/trash');
export const restoreTrashed = (id) => json(`/api/trash/${id}/restore`, { method: 'POST' });
export const purgeTrashed = (id) => json(`/api/trash/${id}`, { method: 'DELETE' });

export async function moveMap(name, fromTeam, toTeam) {
    const r = await fetch(mapUrl(name, fromTeam), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        body: JSON.stringify({ to_team: toTeam }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'that map could not be moved');

    return d;
}

export async function putThumb(name, team, blob) {
    const url = `/api/maps/${encodeURIComponent(name)}/thumb${team != null ? `?team=${team}` : ''}`;
    const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp', 'X-CSRF-TOKEN': csrf },
        body: blob,
    });

    return r.ok;
}

export function logClothingUpload(meta, file) {
    const body = new FormData();
    for (const [k, v] of Object.entries(meta)) {
        if (v !== null && v !== undefined) body.append(k, v);
    }
    if (file) body.append('image', file, file.name);

    return fetch('/api/clothing/log', {
        method: 'POST',
        headers: { 'X-CSRF-TOKEN': csrf },
        body,
    }).catch(() => {});
}

export async function renameMap(name, team, to) {
    const r = await fetch(mapUrl(name, team), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        body: JSON.stringify({ to_name: to }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'that map could not be renamed');

    return d;
}

export async function deleteMap(name, team) {
    const r = await fetch(mapUrl(name, team), {
        method: 'DELETE',
        headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'that map could not be deleted');

    return d;
}

export const listTeams = () => fetch('/api/teams', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : { teams: [] }))
    .catch(() => ({ teams: [] }));

async function team(path, options = {}) {
    const r = await fetch(`/api/teams${path}`, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'that did not work');

    return d;
}

export const createTeam = (name) => team('', { method: 'POST', body: { name } });
export const deleteTeam = (id) => team(`/${id}`, { method: 'DELETE' });
export const teamMembers = (id) => team(`/${id}/members`);
export const addTeamMember = (id, who, role) => team(`/${id}/members`, { method: 'POST', body: { who, role } });
export const setMemberRole = (id, user, role) => team(`/${id}/members/${user}`, { method: 'PATCH', body: { role } });
export const removeMember = (id, user) => team(`/${id}/members/${user}`, { method: 'DELETE' });

export async function loadStats() {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('failed to load stats');
    return r.json();
}
