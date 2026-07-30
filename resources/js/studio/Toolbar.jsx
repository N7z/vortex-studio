import React, { useState } from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon, PartIcon, SpawnIcon,
    CopyIcon, PasteIcon, DuplicateIcon, SaveIcon, DownloadIcon, HelpIcon, StatsIcon, StudsIcon, PlusIcon,
    TeamIcon, GraphicsIcon,
} from './icons';
import { loadStats } from './api';
import { PRESETS, SCALES, SHADOW_RES, presetName } from './graphics';
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
    hasSelection, hasClipboard, canEdit,
    onAddPart, onAddSpawn, onCopy, onPaste, onDuplicate,
    onSave, onDownload, canSave, canDownload,
    graphics, onGraphics,
    plugins, activePluginId, onTogglePlugin, onNewPlugin,
    live, teamOpen, onToggleTeam, hasMap,
}) {
    const [pop, setPop] = useState(null); // null | 'help' | 'stats' | 'gfx'
    const [stats, setStats] = useState(null);

    const toggleStats = () => {
        if (pop === 'stats') { setPop(null); return; }
        setPop('stats');
        setStats(null);
        loadStats().then(setStats).catch(() => setStats({ error: true }));
    };

    const presetNames = Object.keys(PRESETS);
    const current = presetName(graphics);
    const preset = { names: presetNames, current, index: presetNames.indexOf(current) };

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
                <button className="tool-btn" onClick={onAddPart} disabled={!canEdit}>
                    <PartIcon />
                    Part
                </button>
                <button className="tool-btn" onClick={onAddSpawn} disabled={!canEdit}>
                    <SpawnIcon />
                    Spawn
                </button>
                <button
                    className={`tool-btn ${graphics.studs ? 'active' : ''}`}
                    onClick={() => onGraphics({ studs: !graphics.studs })}
                    title="Show stud textures on top faces"
                >
                    <StudsIcon />
                    Studs
                </button>
            </div>
            <div className="group">
                <button className="tool-btn" onClick={onCopy} disabled={!hasSelection}>
                    <CopyIcon />
                    Copy
                </button>
                <button className="tool-btn" onClick={onPaste} disabled={!hasClipboard || !canEdit}>
                    <PasteIcon />
                    Paste
                </button>
                <button className="tool-btn" onClick={onDuplicate} disabled={!hasSelection || !canEdit}>
                    <DuplicateIcon />
                    Duplicate
                </button>
            </div>
            <div className="group">
                <button
                    className="tool-btn"
                    onClick={onSave}
                    disabled={!canSave}
                    title={live?.live && !live.isOwner ? 'The session owner saves this map' : 'Ctrl+S'}
                >
                    <SaveIcon />
                    Save
                </button>
                <button className="tool-btn" onClick={onDownload} disabled={!canDownload} title="Download this map as .json">
                    <DownloadIcon />
                    Download
                </button>
                <button
                    className={`tool-btn wide ${teamOpen ? 'active' : ''} ${live?.live ? 'is-live' : ''}`}
                    onClick={onToggleTeam}
                    disabled={!hasMap}
                    title={live?.live ? `Live session ${live.code}` : 'Edit this map together'}
                >
                    <TeamIcon />
                    {live?.live ? `Team ${live.members.length}` : 'Team'}
                </button>
            </div>
            <div className="group">
                {plugins.map((p) => {
                    return (
                        <button
                            key={p.id}
                            className={`tool-btn wide ${activePluginId === p.id ? 'active' : ''}`}
                            onClick={() => onTogglePlugin(p.id)}
                            disabled={!hasMap || !canEdit}
                            title={p.name}
                        >
                            <PluginIcon name={p.icon} size={22} strokeWidth={1.6} />
                            {p.name}
                        </button>
                    );
                })}
                <button className="tool-btn" onClick={onNewPlugin} disabled={!hasMap} title="Create or edit a Lua plugin">
                    <PlusIcon />
                    New
                </button>
            </div>
            <div className="group help-group">
                <button
                    className={`tool-btn ${pop === 'gfx' ? 'active' : ''}`}
                    onClick={() => setPop((p) => (p === 'gfx' ? null : 'gfx'))}
                    title="Graphics quality"
                >
                    <GraphicsIcon />
                    Graphics
                </button>
                <button className={`tool-btn ${pop === 'stats' ? 'active' : ''}`} onClick={toggleStats}>
                    <StatsIcon />
                    Stats
                </button>
                <button className={`tool-btn ${pop === 'help' ? 'active' : ''}`} onClick={() => setPop((p) => (p === 'help' ? null : 'help'))}>
                    <HelpIcon />
                    Help
                </button>
            </div>
            {pop === 'gfx' && (
                <>
                    <div className="help-backdrop" onClick={() => setPop(null)} />
                    <div className="help-pop gfx-pop">
                        <h3>Graphics</h3>
                        <div className="gfx-seg">
                            <span
                                className="gfx-seg-thumb"
                                style={{
                                    transform: `translateX(${Math.max(0, preset.index) * 100}%)`,
                                    opacity: preset.index < 0 ? 0 : 1,
                                }}
                            />
                            {preset.names.map((name) => (
                                <button
                                    key={name}
                                    className={preset.current === name ? 'active' : ''}
                                    onClick={() => onGraphics(PRESETS[name])}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                        <label className="arch-check">
                            <input
                                type="checkbox"
                                checked={graphics.shadows}
                                onChange={(e) => onGraphics({ shadows: e.target.checked })}
                            />
                            Shadows
                        </label>
                        <div className="gfx-row">
                            <span>Shadow detail</span>
                            <select
                                value={graphics.shadowRes}
                                disabled={!graphics.shadows}
                                onChange={(e) => onGraphics({ shadowRes: Number(e.target.value) })}
                            >
                                {SHADOW_RES.map(([v, label]) => (
                                    <option key={v} value={v}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="gfx-row">
                            <span>Render resolution</span>
                            <select
                                value={graphics.scale}
                                onChange={(e) => onGraphics({ scale: Number(e.target.value) })}
                            >
                                {SCALES.map(([v, label]) => (
                                    <option key={v} value={v}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <label className="arch-check">
                            <input
                                type="checkbox"
                                checked={graphics.studs}
                                onChange={(e) => onGraphics({ studs: e.target.checked })}
                            />
                            Stud textures
                        </label>
                        <label className="arch-check">
                            <input
                                type="checkbox"
                                checked={graphics.grid}
                                onChange={(e) => onGraphics({ grid: e.target.checked })}
                            />
                            Ground grid
                        </label>
                        <h4>Cost</h4>
                        <ul>
                            <li><b>Shadows</b> draw every part twice</li>
                            <li><b>Stud textures</b> cost one texture per part</li>
                            <li><b>Render resolution</b> loses the least detail per frame saved</li>
                        </ul>
                    </div>
                </>
            )}
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
                            <li><b>Left click</b> selects a part, <b>Ctrl+click</b> adds or removes one from the selection, <b>Ctrl+A</b> selects all</li>
                            <li>Tools on keys <b>W</b> move, <b>E</b> rotate, <b>R</b> scale (or <b>1-4</b>), free while you are not flying</li>
                            <li><b>Drag a part</b> to slide it around: it rests on whatever surface is under the pointer, and <b>R</b> while dragging turns it 90°</li>
                            <li>New parts appear where you are looking, not at the origin</li>
                            <li>The checkboxes and values in the top bar snap moving and scaling (studs) and rotating (degrees)</li>
                            <li><b>Ctrl+C / Ctrl+V</b> copy and paste, <b>Ctrl+D</b> duplicates in place, <b>Delete</b> removes. All of them work on the whole selection</li>
                            <li><b>Ctrl+G</b> groups the selection, <b>Ctrl+Shift+G</b> ungroups. Click a group to select it, double-click to rename</li>
                            <li>Groups are Explorer-only: nothing changes in the map, and they are stored in this browser</li>
                            <li><b>Ctrl+Z</b> undoes the last action, <b>Ctrl+Y</b> redoes it</li>
                            <li><b>Ctrl+S</b> saves</li>
                            <li><b>Graphics</b> drops quality on heavy maps. Shadows off is the biggest win</li>
                        </ul>
                        <h4>Building together</h4>
                        <ul>
                            <li><b>Team</b> starts a session and gives you a link to share</li>
                            <li>Guests arrive as spectators, switch them to <b>Developer</b> to let them build</li>
                            <li>Everyone gets a colour, and you see what they have selected</li>
                            <li><b>Ctrl+Z</b> undoes your own last change, never someone else's</li>
                        </ul>
                        <h4>Your maps</h4>
                        <ul>
                            <li>Saved maps live in your anonymous session for 24 hours, counted from your last save</li>
                            <li>Every save also keeps a copy in this browser, listed under <b>On this device</b> on the start screen</li>
                            <li>Use <b>Download</b> to keep a .json copy, and upload it back anytime</li>
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}
