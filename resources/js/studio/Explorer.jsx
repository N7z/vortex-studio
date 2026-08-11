import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceIcon, LightingIcon, cubeIcon, FolderIcon, ChevronIcon } from './icons';
import { groupIndex } from './groups';
import { EMPTY, isHidden, isLocked } from './flags';
import { lightRef } from './lighting';

const ICON_COLOR = {
    Part: '#b9b9c0',
    SpawnLocation: '#4db84b',
    ShirtPad: '#d66a6a',
    Truss: '#c8a951',
};

const AUTO_OPEN_MAX = 25;
const ROW_H = 20;
const OVERSCAN = 8;

const NO_LIGHTS = [];

export default function Explorer({
    parts, selectedIds, setSelectedId, selectMany, groups = [], onUngroup, onRenameGroup, mapName,
    flags = EMPTY, onFlag, onClearFlags, lights = NO_LIGHTS, onAddPart, onAddLight, onRemoveLight,
    NEW_PART
}) {
    const listRef = useRef(null);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState({});
    const [renaming, setRenaming] = useState(null);
    const [view, setView] = useState({ top: 0, h: 400 });
    const primary = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;

    const q = query.trim().toLowerCase();
    const isOpen = (g) => open[g.id] ?? (g.ids.length <= AUTO_OPEN_MAX);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    const { items, matched } = useMemo(() => {
        const match = ({ p, i }) => !q || p.T.toLowerCase().includes(q) || `#${i}`.includes(q) || String(i) === q;
        const rows = parts.map((p, i) => ({ p, i })).filter(match);

        const byPart = groupIndex(groups);
        const buckets = new Map(groups.map((g) => [g.id, []]));
        const loose = [];
        for (const row of rows) {
            const g = byPart.get(row.p._id);
            if (g) buckets.get(g.id).push(row);
            else loose.push(row);
        }

        const out = [];
        if (!q) out.push({ k: 'ws' });
        for (const g of groups) {
            const rowsIn = buckets.get(g.id) ?? [];
            if (q && !rowsIn.length) continue;
            out.push({ k: 'group', g });
            if (open[g.id] ?? (g.ids.length <= AUTO_OPEN_MAX)) {
                for (const row of rowsIn) out.push({ k: 'part', row, nested: true });
            }
        }
        for (const row of loose) out.push({ k: 'part', row });

        const shown = lights.filter((l) => !q || l.N.toLowerCase().includes(q));
        if (!q || shown.length) out.push({ k: 'lighting' });
        if (!q || shown.length) {
            for (const l of shown) out.push({ k: 'lightrow', light: l });
        }

        return { items: out, matched: rows.length + shown.length };
    }, [parts, groups, lights, q, open]);

    const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
    const last = Math.min(items.length, Math.ceil((view.top + view.h) / ROW_H) + OVERSCAN);
    const slice = items.slice(first, last);

    const measure = () => {
        const el = listRef.current;
        if (!el) return;
        setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight
            ? v
            : { top: el.scrollTop, h: el.clientHeight }));
    };

    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el) return;
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const el = listRef.current;
        if (!el || primary == null) return;
        const idx = items.findIndex((it) => it.k === 'part' && it.row.p._id === primary);
        if (idx < 0) return;
        const y = idx * ROW_H;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
    }, [primary]);

    const toggles = (ids, hidden, locked) => (
        <span className="tree-flags">
            <button
                className={`flag ${hidden ? 'on' : ''}`}
                title={hidden ? 'Show' : 'Hide'}
                onClick={(e) => { e.stopPropagation(); onFlag?.('hide', ids, !hidden); }}
            >
                {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button
                className={`flag ${locked ? 'on' : ''}`}
                title={locked ? 'Unlock' : 'Lock'}
                onClick={(e) => { e.stopPropagation(); onFlag?.('lock', ids, !locked); }}
            >
                {locked ? <Lock size={13} /> : <LockOpen size={13} />}
            </button>
        </span>
    );

    const partRow = ({ p }, nested) => {
        const hidden = isHidden(flags, p);
        const locked = isLocked(flags, p);

        return (
            <div
                key={p._id}
                className={`tree-item child ${nested ? 'nested' : ''} ${selected.has(p._id) ? 'selected' : ''}`
                    + `${hidden ? ' is-hidden' : ''}${locked ? ' is-locked' : ''}`}
                onClick={(e) => setSelectedId(p._id, e.ctrlKey || e.metaKey, null, true)}
            >
                <span className="icon">{cubeIcon(ICON_COLOR[p.T] ?? '#b9b9c0')}</span>
                {p.T}
                {toggles([p._id], hidden, locked)}
            </div>
        );
    };

    const groupRow = (g) => (
        <div key={g.id} className={`tree-item group ${g.ids.some((id) => selected.has(id)) ? 'selected' : ''}`}>
            <button
                className={`twist ${isOpen(g) ? 'open' : ''}`}
                onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen(g) }))}
                title={isOpen(g) ? 'Collapse' : 'Expand'}
            >
                <ChevronIcon />
            </button>
            <span className="icon"><FolderIcon /></span>
            {renaming === g.id ? (
                <input
                    className="group-name"
                    autoFocus
                    defaultValue={g.name}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v) onRenameGroup?.(g.id, v);
                        setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.target.blur();
                        if (e.key === 'Escape') setRenaming(null);
                    }}
                />
            ) : (
                <span
                    className="label"
                    onClick={(e) => selectMany?.(g.ids, e.ctrlKey || e.metaKey)}
                    onDoubleClick={() => setRenaming(g.id)}
                    title={`${g.name}: click to select all ${g.ids.length}, double-click to rename`}
                >
                    {g.name}
                </span>
            )}
            <span className="count">{g.ids.length}</span>
            {toggles(g.ids, g.ids.every((id) => isHidden(flags, id)), g.ids.every((id) => isLocked(flags, id)))}
            <button className="clear" onClick={() => onUngroup?.(g.id)} title="Ungroup (the parts stay)">×</button>
        </div>
    );

    return (
        <div className="panel explorer">
            <div className="panel-title">Explorer</div>
            <div className="explorer-search">
                <input
                    type="text"
                    placeholder="Search parts..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
                    spellCheck={false}
                />
                {query && <button className="clear" onClick={() => setQuery('')} title="Clear">×</button>}
            </div>
            <div className="panel-body" ref={listRef} onScroll={measure}>
                {q && !matched ? (
                    <div className="tree-empty">No parts match "{query}"</div>
                ) : (
                    <>
                        <div style={{ height: first * ROW_H }} />
                        {slice.map((it) => {
                            if (it.k === 'part') return partRow(it.row, it.nested);
                            if (it.k === 'group') return groupRow(it.g);
                            if (it.k === 'ws') {
                                        // I  anyone will replace this with "Add a part" with "Add a instance" and menu of instances because i dont know react :D
                                return (
                                    <div className="tree-item" key="ws" onClick={() => setSelectedId(null)}>
                                        <span className="icon"><WorkspaceIcon /></span>
                                        Workspace{mapName ? `: ${mapName}` : ''}

                                        {onAddPart && (
                                            <button
                                                className="add"
                                                title="Add a part"
                                                onClick={(e) => { e.stopPropagation(); onAddPart(NEW_PART); }}
                                            >
                                                +
                                            </button>
                                        )}
                                        <span className="tree-flags">
                                            {!!flags.hide.size && (
                                                <button
                                                    className="flag on"
                                                    title={`Show all ${flags.hide.size} hidden`}
                                                    onClick={(e) => { e.stopPropagation(); onClearFlags?.('hide'); }}
                                                >
                                                    <EyeOff size={13} />
                                                </button>
                                            )}
                                            {!!flags.lock.size && (
                                                <button
                                                    className="flag on"
                                                    title={`Unlock all ${flags.lock.size}`}
                                                    onClick={(e) => { e.stopPropagation(); onClearFlags?.('lock'); }}
                                                >
                                                    <Lock size={13} />
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                );
                            }
                            if (it.k === 'lightrow') {
                                const ref = lightRef(it.light._id);

                                return (
                                    <div
                                        key={ref}
                                        className={`tree-item child ${selected.has(ref) ? 'selected' : ''}`}
                                        onClick={(e) => setSelectedId(ref, e.ctrlKey || e.metaKey, null, true)}
                                    >
                                        <span className="icon"><LightingIcon /></span>
                                        {it.light.N}
                                        {onRemoveLight && (
                                            <button
                                                className="clear"
                                                title="Delete this light"
                                                onClick={(e) => { e.stopPropagation(); onRemoveLight(it.light._id); }}
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                );
                            }

                            return (
                                <div className="tree-item" key="light">
                                    <span className="icon"><LightingIcon /></span>
                                    Lighting
                                    <span className="count">{lights.length}</span>
                                    {onAddLight && (
                                        <button
                                            className="add"
                                            title="Add a light"
                                            onClick={(e) => { e.stopPropagation(); onAddLight(); }}
                                        >
                                            +
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                        <div style={{ height: Math.max(0, (items.length - last) * ROW_H) }} />
                    </>
                )}
            </div>
        </div>
    );
}
