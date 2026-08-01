const KEY = 'studio_rates';
const ALPHA = 0.35;
const MIN_MS = 200;

function read() {
    try {
        const v = JSON.parse(localStorage.getItem(KEY));
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

function write(rates) {
    try {
        localStorage.setItem(KEY, JSON.stringify(rates));
    } catch { /* private mode, or the quota is full */ }
}

export function predict(kind, units) {
    if (!(units > 0)) return null;
    const rate = read()[kind];
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const ms = rate * units;
    return ms >= MIN_MS ? ms : null;
}

export function record(kind, units, ms) {
    if (!(units > 0) || !(ms >= MIN_MS)) return;
    const rates = read();
    const prev = rates[kind];
    const now = ms / units;
    rates[kind] = Number.isFinite(prev) && prev > 0 ? prev + ALPHA * (now - prev) : now;
    write(rates);
}
