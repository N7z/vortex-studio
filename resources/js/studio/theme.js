import { useSyncExternalStore } from 'react';

const KEY = 'studio_theme';

export const THEMES = [
    ['dark', 'Vortex'],
    ['classic', 'Classic'],
    ['pink', 'Pink'],
];

export const isLight = (name) => name === 'classic' || name === 'pink';

export const DEFAULT = 'dark';

const known = (name) => THEMES.some(([id]) => id === name);

function read() {
    try {
        const stored = localStorage.getItem(KEY);
        return known(stored) ? stored : DEFAULT;
    } catch {
        return DEFAULT;
    }
}

let current = read();
const listeners = new Set();

export function applyTheme() {
    document.documentElement.dataset.theme = current;
}

export const getTheme = () => current;

export function setTheme(name) {
    if (!known(name) || name === current) return;
    current = name;
    try {
        localStorage.setItem(KEY, name);
    } catch { /* a full quota must not cost you the theme you are looking at */ }
    applyTheme();
    for (const notify of listeners) notify();
}

const subscribe = (notify) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
};

export const useTheme = () => useSyncExternalStore(subscribe, getTheme, () => DEFAULT);
