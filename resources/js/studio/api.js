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
export const liveToken = () => account('/live-token').then((d) => d.token ?? null).catch(() => null);
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

export async function loadMap(name) {
    const r = await fetch(`/api/maps/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`failed to load ${name}`);
    return r.json();
}

export async function saveMap(name, parts) {
    const r = await fetch(`/api/maps/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parts),
    });
    if (!r.ok) throw new Error(`failed to save ${name}`);
    return r.json();
}

export async function loadStats() {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('failed to load stats');
    return r.json();
}
