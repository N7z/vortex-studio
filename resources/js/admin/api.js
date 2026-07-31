const csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? '';

async function call(path, options = {}) {
    const r = await fetch(`/admin${path}`, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || `request failed (${r.status})`);
    return data;
}

const query = (params) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return q.toString() ? `?${q}` : '';
};

export const overview = () => call('/overview');
export const listUsers = (params) => call(`/users${query(params)}`);
export const listMaps = (params) => call(`/maps${query(params)}`);
export const setBanned = (id, banned) => call(`/users/${id}`, { method: 'PATCH', body: { banned } });
export const deleteUser = (id) => call(`/users/${id}`, { method: 'DELETE' });
export const deleteMap = (id) => call(`/maps/${id}`, { method: 'DELETE' });
