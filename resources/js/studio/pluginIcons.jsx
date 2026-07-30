import React from 'react';
import { DynamicIcon } from 'lucide-react/dynamic';
import { FileCode } from 'lucide-react';
import { LUCIDE_KEBAB } from './lucideNames';

const pascal = (k) => k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');

const KEBAB = new Set(LUCIDE_KEBAB);
const BY_PASCAL = new Map(LUCIDE_KEBAB.map((k) => [pascal(k), k]));

export const ICON_NAMES = [...BY_PASCAL.keys()];

export function resolveIcon(name) {
    const s = String(name ?? '').trim();
    if (!s) return null;
    if (KEBAB.has(s)) return s;
    return BY_PASCAL.get(s) ?? BY_PASCAL.get(pascal(s.toLowerCase())) ?? null;
}

export function PluginIcon({ name, size = 16, strokeWidth = 1.8, className }) {
    const kebab = resolveIcon(name);
    const fallback = () => <FileCode size={size} strokeWidth={strokeWidth} className={className} />;
    if (!kebab) return fallback();
    return (
        <DynamicIcon
            name={kebab}
            fallback={fallback}
            size={size}
            strokeWidth={strokeWidth}
            className={className}
        />
    );
}
