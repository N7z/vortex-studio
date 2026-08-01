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
        ? { parts: d, groups: [], version: 0 }
        : { parts: d.parts ?? [], groups: d.groups ?? [], version: d.version ?? 0 };
}

/** Throws a StaleError when somebody else saved since this copy was loaded. */
export class StaleError extends Error {
    constructor(version) {
        super('someone else saved this map');
        this.stale = true;
        this.version = version;
    }
}

export async function saveMap(name, parts, groups, team = null, version = null) {
    const r = await fetch(mapUrl(name, team), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        body: JSON.stringify({ parts, groups, version }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 409) throw new StaleError(d.version ?? null);
    if (!r.ok) throw new Error(d.message || `failed to save ${name}`);

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
export const addTeamMember = (id, email, role) => team(`/${id}/members`, { method: 'POST', body: { email, role } });
export const setMemberRole = (id, user, role) => team(`/${id}/members/${user}`, { method: 'PATCH', body: { role } });
export const removeMember = (id, user) => team(`/${id}/members/${user}`, { method: 'DELETE' });

export async function loadStats() {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('failed to load stats');
    return r.json();
}
