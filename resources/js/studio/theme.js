// Which skin the editor wears. The choice is one attribute on <html>: every
// colour the interface draws with is a custom property, and a theme is a block
// that redefines them, so nothing here has to know what any panel looks like.
// It is a browser preference, not part of the document, so it never travels
// with a saved map and never reaches anyone you are building with.

import { useSyncExternalStore } from 'react';

const KEY = 'studio_theme';

export const THEMES = [
    ['dark', 'Vortex'],
    ['classic', 'Classic'],
];

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

// Called before React mounts as well as on every change, so the first paint is
// already wearing the right theme instead of flashing the default one.
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
