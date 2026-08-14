import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceIcon, LightingIcon, cubeIcon, FolderIcon, ChevronIcon } from './icons';
import { groupIndex, groupParts, groupTree } from './groups';
import { EMPTY, isHidden, isLocked } from './flags';
import { AMBIENT, SUN, partLightRef, pointLightOf, spotLightOf } from './lighting';

const ICON_COLOR = {
    Part: '#b9b9c0',
    SpawnLocation: '#4db84b',
    ShirtPad: '#d66a6a',
    Truss: '#c8a951',
};

const AUTO_OPEN_MAX = 25;
const ROW_H = 20;
const OVERSCAN = 8;

const UNDER_PART = [
    { kind: 'point', label: 'PointLight', held: (p) => !!pointLightOf(p) },
    { kind: 'spot', label: 'SpotLight', held: (p) => !!spotLightOf(p) },
];

const RIG = [
    { ref: AMBIENT, label: 'Ambient', key: 'ambient' },
    { ref: SUN, label: 'Sun', key: 'sun' },
];

// Every row reserves the same twist slot whether or not it has one, so the icons
// down a column line up and a guide can be drawn at a fixed offset from the indent.
const rowProps = (depth) => ({
    style: { '--indent': `${6 + depth * 14}px` },
    ...(depth ? { 'data-nested': '' } : {}),
});

const Twist = ({ open, onToggle }) => (onToggle ? (
    <button
        className={`twist ${open ? 'open' : ''}`}
        title={open ? 'Collapse' : 'Expand'}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
        <ChevronIcon />
    </button>
) : <span className="twist-gap" />);

export default function Explorer({
    parts, selectedIds, setSelectedId, selectMany, groups = [], onUngroup, onRenameGroup, mapName,
    flags = EMPTY, onFlag, onClearFlags, onAddPart, onAddUnder, NEW_PART
}) {
    const listRef = useRef(null);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState({});
    const [renaming, setRenaming] = useState(null);
    // Which part's add menu is open, and where to hang it.
    const [adding, setAdding] = useState(null);
    const [view, setView] = useState({ top: 0, h: 400 });
    const primary = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;

    const q = query.trim().toLowerCase();
    // Groups past a certain size start closed; the two roots start open.
    const isOpen = (g) => open[g.id] ?? (g.ids.length <= AUTO_OPEN_MAX);
    const rootOpen = (key) => open[key] ?? true;
    const toggle = (key, next) => setOpen((o) => ({ ...o, [key]: next }));
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

        // A search flattens the tree: what matched has to be reachable, whatever is collapsed.
        const wsOpen = q || (open.ws ?? true);
        const lightsOpen = q || (open.lighting ?? true);

        const { roots, childrenOf } = groupTree(groups);

        // A group holds parts and other groups, so the tree is walked rather than listed. Under a
        // search, a group earns its row when anything below it matched.
        const held = (g) => (buckets.get(g.id) ?? []).length
            + childrenOf(g.id).reduce((n, c) => n + held(c), 0);

        // A light on a part is shown as its child, the way the part carries it.
        const pushPart = (row, depth) => {
            out.push({ k: 'part', row, depth });
            const point = pointLightOf(row.p);
            const spot = spotLightOf(row.p);
            if (point) out.push({ k: 'partlight', row, kind: 'point', depth: depth + 1 });
            if (spot) out.push({ k: 'partlight', row, kind: 'spot', depth: depth + 1 });
        };

        const walk = (list, depth) => {
            for (const g of list) {
                if (q && !held(g)) continue;
                out.push({ k: 'group', g, depth });
                if (!(open[g.id] ?? (g.ids.length <= AUTO_OPEN_MAX))) continue;
                walk(childrenOf(g.id), depth + 1);
                for (const row of buckets.get(g.id) ?? []) pushPart(row, depth + 1);
            }
        };

        const out = [];
        if (!q) out.push({ k: 'ws', depth: 0 });
        if (wsOpen) {
            walk(roots, 1);
            for (const row of loose) pushPart(row, 1);
        }

        const shown = RIG.filter((r) => !q || r.label.toLowerCase().includes(q));
        if (shown.length) out.push({ k: 'lighting', depth: 0 });
        if (lightsOpen) {
            for (const r of shown) out.push({ k: 'lightrow', rig: r, depth: 1 });
        }

        return { items: out, matched: rows.length + shown.length };
    }, [parts, groups, q, open]);

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

    const partRow = ({ p }, depth) => {
        const hidden = isHidden(flags, p);
        const locked = isLocked(flags, p);
        const canAdd = onAddUnder && UNDER_PART.some((it) => !it.held(p));

        return (
            <div
                key={p._id}
                {...rowProps(depth)}
                className={`tree-item child ${selected.has(p._id) ? 'selected' : ''}`
                    + `${hidden ? ' is-hidden' : ''}${locked ? ' is-locked' : ''}`}
                onClick={(e) => setSelectedId(p._id, e.ctrlKey || e.metaKey, null, true)}
            >
                <Twist />
                <span className="icon">{cubeIcon(ICON_COLOR[p.T] ?? '#b9b9c0')}</span>
                {p.T}
                {canAdd && (
                    <button
                        className="add"
                        title="Add something under this part"
                        onClick={(e) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            setAdding((cur) => (cur?.id === p._id
                                ? null
                                : { id: p._id, x: r.left, y: r.bottom + 2 }));
                        }}
                    >
                        +
                    </button>
                )}
                {toggles([p._id], hidden, locked)}
            </div>
        );
    };

    const groupRow = (g, depth) => {
        const held = groupParts(groups, g.id);

        return (
        <div
            key={g.id}
            {...rowProps(depth)}
            className={`tree-item group ${held.some((id) => selected.has(id)) ? 'selected' : ''}`}
        >
            <Twist open={isOpen(g)} onToggle={() => toggle(g.id, !isOpen(g))} />
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
                    onClick={(e) => selectMany?.(held, e.ctrlKey || e.metaKey)}
                    onDoubleClick={() => setRenaming(g.id)}
                    title={`${g.name}: click to select all ${held.length}, double-click to rename`}
                >
                    {g.name}
                </span>
            )}
            <span className="count">{held.length}</span>
            {toggles(held, held.every((id) => isHidden(flags, id)), held.every((id) => isLocked(flags, id)))}
            <button
                className="clear"
                onClick={() => onUngroup?.(g.id)}
                title="Ungroup (what is inside stays, one level up)"
            >
                ×
            </button>
        </div>
        );
    };

    const addingPart = adding ? parts.find((p) => p._id === adding.id) ?? null : null;

    return (
        <div className="panel explorer">
            {addingPart && (
                <>
                    <div className="tree-add-backdrop" onClick={() => setAdding(null)} />
                    <div className="menu-drop tree-add-menu" style={{ left: adding.x, top: adding.y }}>
                        {UNDER_PART.map((it) => (
                            <button
                                key={it.kind}
                                className="menu-item"
                                disabled={it.held(addingPart)}
                                onClick={() => {
                                    setAdding(null);
                                    onAddUnder(addingPart._id, it.kind);
                                }}
                            >
                                <span className="menu-tick" />
                                <span className="menu-label">{it.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
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
                            if (it.k === 'part') return partRow(it.row, it.depth);
                            if (it.k === 'partlight') {
                                const ref = partLightRef(it.row.p._id, it.kind);

                                return (
                                    <div
                                        key={ref}
                                        {...rowProps(it.depth)}
                                        className={`tree-item child ${selected.has(ref) ? 'selected' : ''}`}
                                        onClick={() => setSelectedId(ref, false, null, true)}
                                    >
                                        <Twist />
                                        <span className="icon"><LightingIcon /></span>
                                        {it.kind === 'point' ? 'PointLight' : 'SpotLight'}
                                    </div>
                                );
                            }
                            if (it.k === 'group') return groupRow(it.g, it.depth);
                            if (it.k === 'ws') {
                                        // I  anyone will replace this with "Add a part" with "Add a instance" and menu of instances because i dont know react :D
                                return (
                                    <div
                                        className="tree-item"
                                        key="ws"
                                        {...rowProps(0)}
                                        onClick={() => setSelectedId(null)}
                                    >
                                        <Twist open={rootOpen('ws')} onToggle={() => toggle('ws', !rootOpen('ws'))} />
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
                                return (
                                    <div
                                        key={it.rig.ref}
                                        {...rowProps(it.depth)}
                                        className={`tree-item child ${selected.has(it.rig.ref) ? 'selected' : ''}`}
                                        onClick={() => setSelectedId(it.rig.ref, false, null, true)}
                                    >
                                        <Twist />
                                        <span className="icon"><LightingIcon /></span>
                                        {it.rig.label}
                                    </div>
                                );
                            }

                            return (
                                <div className="tree-item" key="light" {...rowProps(0)}>
                                    <Twist
                                        open={rootOpen('lighting')}
                                        onToggle={() => toggle('lighting', !rootOpen('lighting'))}
                                    />
                                    <span className="icon"><LightingIcon /></span>
                                    Lighting
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
