import React, { useEffect, useRef } from 'react';
import { WorkspaceIcon, LightingIcon, cubeIcon } from './icons';

const ICON_COLOR = {
    Part: '#b9b9c0',
    SpawnLocation: '#4db84b',
    ShirtPad: '#d66a6a',
    Truss: '#c8a951',
};

export default function Explorer({ parts, selectedId, setSelectedId, mapName }) {
    const listRef = useRef(null);

    useEffect(() => {
        const el = listRef.current?.querySelector('.tree-item.selected');
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    return (
        <div className="panel explorer">
            <div className="panel-title">Explorer</div>
            <div className="panel-body" ref={listRef}>
                <div className="tree-item" onClick={() => setSelectedId(null)}>
                    <span className="icon"><WorkspaceIcon /></span>
                    Workspace{mapName ? `: ${mapName}` : ''}
                </div>
                {parts.map((p, i) => (
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
                <div className="tree-item">
                    <span className="icon"><LightingIcon /></span>
                    Lighting
                </div>
            </div>
        </div>
    );
}
