import { useCallback, useEffect, useRef, useState } from 'react';
import { isMobileNow } from './useIsMobile';

const KEY = 'studio_windows';
const MARGIN = 40;

const readAll = () => {
    try {
        const all = JSON.parse(localStorage.getItem(KEY));

        return all && typeof all === 'object' ? all : {};
    } catch {
        return {};
    }
};

const readOne = (key) => {
    if (!key) return null;
    const saved = readAll()[key];
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return null;

    return {
        left: Math.min(Math.max(saved.left, 0), Math.max(window.innerWidth - MARGIN, 0)),
        top: Math.min(Math.max(saved.top, 0), Math.max(window.innerHeight - MARGIN, 0)),
    };
};

const writeOne = (key, pos) => {
    if (!key || !pos) return;
    const all = readAll();
    all[key] = pos;
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* private mode, the window just will not remember */ }
};

export default function useDraggable(key) {
    const fixed = isMobileNow();
    const [pos, setPos] = useState(() => (fixed ? null : readOne(key)));
    const grab = useRef(null);
    const latest = useRef(pos);
    latest.current = pos;

    const onPointerDown = useCallback((e) => {
        if (fixed) return;
        if (e.button !== 0 || e.target.closest('button, select, input, textarea')) return;
        const el = e.currentTarget.parentElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const host = el.offsetParent?.getBoundingClientRect();
        const ox = host?.left ?? 0;
        const oy = host?.top ?? 0;
        grab.current = {
            dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, ox, oy,
        };
        setPos({ left: r.left - ox, top: r.top - oy });
        e.preventDefault();
    }, [fixed]);

    useEffect(() => {
        const move = (e) => {
            const g = grab.current;
            if (!g) return;
            const maxLeft = Math.max(window.innerWidth - g.w, 0);
            const maxTop = Math.max(window.innerHeight - g.h, 0);
            const left = Math.min(Math.max(e.clientX - g.dx, 0), maxLeft);
            const top = Math.min(Math.max(e.clientY - g.dy, 0), maxTop);
            setPos({ left: left - g.ox, top: top - g.oy });
        };
        const drop = () => {
            if (!grab.current) return;
            grab.current = null;
            writeOne(key, latest.current);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', drop);
        window.addEventListener('blur', drop);

        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', drop);
            window.removeEventListener('blur', drop);
        };
    }, [key]);

    const style = pos
        ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' }
        : undefined;

    return { style, onPointerDown };
}
