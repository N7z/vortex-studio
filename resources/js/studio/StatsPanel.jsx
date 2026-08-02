import React, { useEffect, useMemo, useState } from 'react';
import useDraggable from './useDraggable';
import { ENGINE_MAX_BYTES, stripIds } from './ops';

const n = (v) => (v ?? 0).toLocaleString();

const SIZE_SLICE = 5000;
const SETTLE_MS = 250;

const bytesLabel = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(2)} MB`;
};

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

    const [bytes, setBytes] = useState(null);
    const [settled, setSettled] = useState(parts);

    useEffect(() => {
        const t = setTimeout(() => setSettled(parts), SETTLE_MS);

        return () => clearTimeout(t);
    }, [parts]);

    useEffect(() => {
        const t = setInterval(() => setRender(statsRef?.current ?? null), 500);

        return () => clearInterval(t);
    }, [statsRef]);

    useEffect(() => {
        if (!settled.length) {
            setBytes(0);
            return undefined;
        }
        let cancelled = false;
        let at = 0;
        let inner = 0;
        let chunks = 0;
        setBytes(null);
        const step = () => {
            if (cancelled) return;
            const end = Math.min(at + SIZE_SLICE, settled.length);
            inner += JSON.stringify(stripIds(settled.slice(at, end))).length - 2;
            chunks += 1;
            at = end;
            if (at < settled.length) {
                setTimeout(step, 0);
                return;
            }
            setBytes(inner + chunks + 1);
        };
        step();

        return () => { cancelled = true; };
    }, [settled]);

    const map = useMemo(() => {
        const types = new Map();
        const colors = new Set();
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        let studs = 0;
        for (const p of settled) {
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
            size: settled.length
                ? [0, 1, 2].map((i) => Math.round(max[i] - min[i])).join(' x ')
                : null,
        };
    }, [settled]);

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
                        <Row
                            label="File size"
                            value={bytes == null ? '...' : bytesLabel(bytes)}
                            hint={`What this map saves as. The game refuses anything over ${bytesLabel(ENGINE_MAX_BYTES)}`}
                        />
                        {bytes != null && bytes > ENGINE_MAX_BYTES ? (
                            <span className="team-hint">
                                {`Over the ${bytesLabel(ENGINE_MAX_BYTES)} the game accepts.`}
                            </span>
                        ) : null}
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
                            label="Blocked"
                            value={`${render.blocked ?? 0} %`}
                            hint="Share of the last half second spent in long tasks. High here with a low Viewport CPU means something outside the renderer is holding the main thread"
                        />
                        {render.heap == null ? null : (
                            <Row label="JS heap" value={`${n(render.heap)} MB`} />
                        )}
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
