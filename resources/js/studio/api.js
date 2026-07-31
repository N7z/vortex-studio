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

// A bare array is what an older server returns; both shapes stay readable.
export async function loadMap(name) {
    const r = await fetch(`/api/maps/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`failed to load ${name}`);
    const d = await r.json();

    return Array.isArray(d) ? { parts: d, groups: [] } : { parts: d.parts ?? [], groups: d.groups ?? [] };
}

export async function saveMap(name, parts, groups) {
    const r = await fetch(`/api/maps/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        body: JSON.stringify({ parts, groups }),
    });
    if (!r.ok) throw new Error(`failed to save ${name}`);
    return r.json();
}

export async function loadStats() {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('failed to load stats');
    return r.json();
}
