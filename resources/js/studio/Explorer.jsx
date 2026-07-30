import React, { useEffect, useRef, useState } from 'react';
import { WorkspaceIcon, LightingIcon, cubeIcon } from './icons';

const ICON_COLOR = {
    Part: '#b9b9c0',
    SpawnLocation: '#4db84b',
    ShirtPad: '#d66a6a',
    Truss: '#c8a951',
};

export default function Explorer({ parts, selectedId, setSelectedId, mapName }) {
    const listRef = useRef(null);
    const [query, setQuery] = useState('');

    useEffect(() => {
        const el = listRef.current?.querySelector('.tree-item.selected');
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    const q = query.trim().toLowerCase();
    const rows = parts
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => !q || p.T.toLowerCase().includes(q) || `#${i}`.includes(q) || String(i) === q);

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
            <div className="panel-body" ref={listRef}>
                {!q && (
                    <div className="tree-item" onClick={() => setSelectedId(null)}>
                        <span className="icon"><WorkspaceIcon /></span>
                        Workspace{mapName ? `: ${mapName}` : ''}
                    </div>
                )}
                {rows.map(({ p, i }) => (
                    <div
                        key={p._id}
                        className={`tree-item child ${p._id === selectedId ? 'selected' : ''}`}
                        onClick={() => setSelectedId(p._id)}
                    >
                        <span className="icon">{cubeIcon(ICON_COLOR[p.T] ?? '#b9b9c0')}</span>
                        {p.T}
                        <span style={{ color: '#666', fontSize: 11 }}>#{i}</span>
                    </div>
                ))}
                {q && rows.length === 0 && <div className="tree-empty">No parts match "{query}"</div>}
                {!q && (
                    <div className="tree-item">
                        <span className="icon"><LightingIcon /></span>
                        Lighting
                    </div>
                )}
            </div>
        </div>
    );
}
