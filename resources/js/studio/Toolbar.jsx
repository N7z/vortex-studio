import React, { useState } from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon, PartIcon, SpawnIcon,
    CopyIcon, PasteIcon, DuplicateIcon, SaveIcon, DownloadIcon, HelpIcon, StatsIcon, StudsIcon, PlusIcon,
} from './icons';
import { loadStats } from './api';
import { PluginIcon } from './pluginIcons';

function ago(ts) {
    if (!ts) return 'never';
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
}

const STAT_LABELS = [
    ['maps', 'Saved maps'],
    ['sessions', 'Active sessions'],
    ['parts', 'Parts across saved maps'],
    ['examples', 'Example maps'],
];

const TOOLS = [
    ['select', 'Select', SelectIcon],
    ['move', 'Move', MoveIcon],
    ['rotate', 'Rotate', RotateIcon],
    ['scale', 'Scale', ScaleIcon],
];

export default function Toolbar({
    tool, setTool, snap, setSnap,
    hasSelection, hasClipboard,
    onAddPart, onAddSpawn, onCopy, onPaste, onDuplicate,
    onSave, onDownload, canSave,
    studs, onToggleStuds,
    plugins, activePluginId, onTogglePlugin, onNewPlugin,
}) {
    const [pop, setPop] = useState(null); // null | 'help' | 'stats'
    const [stats, setStats] = useState(null);

    const toggleStats = () => {
        if (pop === 'stats') { setPop(null); return; }
        setPop('stats');
        setStats(null);
        loadStats().then(setStats).catch(() => setStats({ error: true }));
    };

    const numInput = (key) => (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v) && v > 0) setSnap({ ...snap, [key]: v });
    };

    return (
        <div className="toolbar">
            <div className="group">
                {TOOLS.map(([id, label, Icon]) => (
                    <button
                        key={id}
                        className={`tool-btn ${tool === id ? 'active' : ''}`}
                        onClick={() => setTool(id)}
                    >
                        <Icon />
                        {label}
                    </button>
                ))}
            </div>
            <div className="group snap-group">
                <div className="snap-row">
                    <input
                        type="checkbox"
                        checked={snap.moveOn}
                        onChange={(e) => setSnap({ ...snap, moveOn: e.target.checked })}
                    />
                    <input type="text" defaultValue={snap.move} onBlur={numInput('move')} title="Move snap (studs)" />
                    <span className="snap-icon" title="Move snap (studs)"><MoveIcon /></span>
                </div>
                <div className="snap-row">
                    <input
                        type="checkbox"
                        checked={snap.rotateOn}
                        onChange={(e) => setSnap({ ...snap, rotateOn: e.target.checked })}
                    />
                    <input type="text" defaultValue={snap.rotate} onBlur={numInput('rotate')} title="Rotate snap (degrees)" />
                    <span className="snap-icon" title="Rotate snap (degrees)"><RotateIcon /></span>
                </div>
            </div>
            <div className="group">
                <button className="tool-btn" onClick={onAddPart}>
                    <PartIcon />
                    Part
                </button>
                <button className="tool-btn" onClick={onAddSpawn}>
                    <SpawnIcon />
                    Spawn
                </button>
                <button className={`tool-btn ${studs ? 'active' : ''}`} onClick={onToggleStuds} title="Show stud textures on top faces">
                    <StudsIcon />
                    Studs
                </button>
            </div>
            <div className="group">
                <button className="tool-btn" onClick={onCopy} disabled={!hasSelection}>
                    <CopyIcon />
                    Copy
                </button>
                <button className="tool-btn" onClick={onPaste} disabled={!hasClipboard}>
                    <PasteIcon />
                    Paste
                </button>
                <button className="tool-btn" onClick={onDuplicate} disabled={!hasSelection}>
                    <DuplicateIcon />
                    Duplicate
                </button>
            </div>
            <div className="group">
                <button className="tool-btn" onClick={onSave} disabled={!canSave} title="Ctrl+S">
                    <SaveIcon />
                    Save
                </button>
                <button className="tool-btn" onClick={onDownload} disabled={!canSave} title="Download this map as .json">
                    <DownloadIcon />
                    Download
                </button>
            </div>
            <div className="group">
                {plugins.map((p) => {
                    return (
                        <button
                            key={p.id}
                            className={`tool-btn wide ${activePluginId === p.id ? 'active' : ''}`}
                            onClick={() => onTogglePlugin(p.id)}
                            disabled={!canSave}
                            title={p.name}
                        >
                            <PluginIcon name={p.icon} size={22} strokeWidth={1.6} />
                            {p.name}
                        </button>
                    );
                })}
                <button className="tool-btn" onClick={onNewPlugin} disabled={!canSave} title="Create or edit a Lua plugin">
                    <PlusIcon />
                    New
                </button>
            </div>
            <div className="group help-group">
                <button className={`tool-btn ${pop === 'stats' ? 'active' : ''}`} onClick={toggleStats}>
                    <StatsIcon />
                    Stats
                </button>
                <button className={`tool-btn ${pop === 'help' ? 'active' : ''}`} onClick={() => setPop((p) => (p === 'help' ? null : 'help'))}>
                    <HelpIcon />
                    Help
                </button>
            </div>
            {pop === 'stats' && (
                <>
                    <div className="help-backdrop" onClick={() => setPop(null)} />
                    <div className="help-pop">
                        <h3>Stats</h3>
                        {!stats ? (
                            <div className="stats-note">Loading...</div>
                        ) : stats.error ? (
                            <div className="stats-note">Could not load stats</div>
                        ) : (
                            <div className="stats-grid">
                                {STAT_LABELS.map(([key, label]) => (
                                    <div className="stat-card" key={key}>
                                        <div className="value">{(stats[key] ?? 0).toLocaleString()}</div>
                                        <div className="label">{label}</div>
                                    </div>
                                ))}
                                <div className="stat-card">
                                    <div className="value">{ago(stats.last_save)}</div>
                                    <div className="label">Last save</div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
            {pop === 'help' && (
                <>
                    <div className="help-backdrop" onClick={() => setPop(null)} />
                    <div className="help-pop">
                        <h3>Quick help</h3>
                        <h4>Camera</h4>
                        <ul>
                            <li>Hold <b>right mouse</b> to look around</li>
                            <li>While holding it: <b>WASD</b> to fly, <b>E</b> up, <b>Q</b> down, <b>Shift</b> faster</li>
                            <li><b>Middle mouse</b> pans, <b>wheel</b> zooms</li>
                        </ul>
                        <h4>Editing</h4>
                        <ul>
                            <li><b>Left click</b> selects a part, tools on keys <b>1-4</b></li>
                            <li>The checkboxes and values in the top bar snap moving and scaling (studs) and rotating (degrees)</li>
                            <li><b>Ctrl+C / Ctrl+V</b> copy and paste, <b>Ctrl+D</b> duplicates in place, <b>Delete</b> removes</li>
                            <li><b>Ctrl+Z</b> undoes the last action</li>
                            <li><b>Ctrl+S</b> saves</li>
                        </ul>
                        <h4>Your maps</h4>
                        <ul>
                            <li>Saved maps live in your anonymous session for 24 hours</li>
                            <li>Use <b>Download</b> to keep a .json copy, and upload it back anytime</li>
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}
