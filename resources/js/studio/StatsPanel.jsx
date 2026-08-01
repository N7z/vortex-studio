import React, { useEffect, useMemo, useState } from 'react';
import useDraggable from './useDraggable';

const n = (v) => (v ?? 0).toLocaleString();

function Row({ label, value, hint }) {
    return (
        <div className="stat-line" title={hint}>
            <span className="stat-key">{label}</span>
            <span className="stat-val">{value}</span>
        </div>
    );
}

export default function StatsPanel({ parts, selectedIds, groups, mapName, statsRef, onClose }) {
    const { style, onPointerDown } = useDraggable('stats');
    const [render, setRender] = useState(null);

    useEffect(() => {
        const t = setInterval(() => setRender(statsRef?.current ?? null), 500);

        return () => clearInterval(t);
    }, [statsRef]);

    const map = useMemo(() => {
        const types = new Map();
        const colors = new Set();
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        let studs = 0;
        for (const p of parts) {
            types.set(p.T, (types.get(p.T) ?? 0) + 1);
            colors.add(p.C ?? 'a3a2a5');
            studs += (p.S?.[0] ?? 0) * (p.S?.[2] ?? 0);
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p.P[i] - p.S[i] / 2);
                max[i] = Math.max(max[i], p.P[i] + p.S[i] / 2);
            }
        }

        return {
            types: [...types.entries()].sort((a, b) => b[1] - a[1]),
            colors: colors.size,
            studs,
            size: parts.length
                ? [0, 1, 2].map((i) => Math.round(max[i] - min[i])).join(' x ')
                : null,
        };
    }, [parts]);

    return (
        <div className="team-panel stats-panel" style={style}>
            <div className="team-head" onPointerDown={onPointerDown}>
                <span className="team-title">Statistics</span>
                <button className="team-x" onClick={onClose} title="Hide">×</button>
            </div>
            <div className="team-body">
                {!parts.length ? (
                    <span className="team-hint">{mapName ? 'This map is empty.' : 'No map open.'}</span>
                ) : (
                    <>
                        <div className="stat-group">Map</div>
                        <Row label="Parts" value={n(parts.length)} />
                        {map.types.map(([t, c]) => (
                            <Row key={t} label={t} value={n(c)} />
                        ))}
                        <Row label="Selected" value={n(selectedIds.length)} />
                        <Row label="Groups" value={n(groups.length)} />
                        <Row label="Colours" value={n(map.colors)} hint="Distinct part colours" />
                        <Row label="Extent" value={map.size} hint="Bounding box in studs, W x H x D" />
                    </>
                )}

                <div className="stat-group">Render</div>
                {!render ? (
                    <span className="team-hint">Waiting for a frame...</span>
                ) : (
                    <>
                        <Row label="FPS" value={n(render.fps)} />
                        <Row
                            label="Viewport CPU"
                            value={`${render.cpu ?? 0} ms`}
                            hint="Main-thread time inside the viewport's own frame. If this is well under the frame time, the cost is elsewhere on the page"
                        />
                        <Row
                            label="Draw calls"
                            value={n(render.calls)}
                            hint="Without batching this would be roughly one per part, or three with studs"
                        />
                        <Row label="Triangles" value={n(render.triangles)} />
                        <Row
                            label="Batches"
                            value={n(render.batches)}
                            hint="Instanced meshes: parts sharing a type, colour, size and view mode"
                        />
                        <Row
                            label="Unbatched"
                            value={n(render.loose)}
                            hint="Transparent parts, drawn on their own so they blend in the right order"
                        />
                        <Row label="Materials" value={n(render.materials)} />
                        <Row label="Textures" value={n(render.textures)} />
                    </>
                )}
            </div>
        </div>
    );
}
