export async function listMaps() {
    const r = await fetch('/api/maps');
    if (!r.ok) throw new Error('failed to list maps');
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
