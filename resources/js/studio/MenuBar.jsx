import { Maximize, Minimize } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { loadStats } from './api';
import useFullscreen, { canFullscreen } from './useFullscreen';
import { MODES, PRESETS, SCALES, SHADOW_RES, presetName } from './graphics';

const SEP = { sep: true };

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

// One menu title plus its dropdown. `open` is owned by MenuBar so that hovering
// another title while a menu is open switches to it, the way a real menubar does.
function Menu({ title, items, open, onOpen, onHover, onClose }) {
    return (
        <div className="menu">
            <button
                className={`menu-title ${open ? 'open' : ''}`}
                onClick={onOpen}
                onMouseEnter={onHover}
            >
                {title}
            </button>
            {open && (
                <div className="menu-drop">
                    {items.map((it, i) => (it.sep ? (
                        <div className="menu-sep" key={`s${i}`} />
                    ) : (
                        <button
                            className="menu-item"
                            key={it.label}
                            disabled={!!it.disabled}
                            onClick={() => { onClose(); it.onClick?.(); }}
                        >
                            <span className="menu-tick">{it.checked ? '✓' : ''}</span>
                            <span className="menu-label">{it.label}</span>
                            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                        </button>
                    )))}
                </div>
            )}
        </div>
    );
}

// Sticky and zero height, so it stays pinned while a long popup scrolls under it.
const ClosePop = ({ onClose }) => (
    <div className="help-close-bar">
        <button className="help-close" title="Close" onClick={onClose}>×</button>
    </div>
);

export default function MenuBar({
    hasMap, canEdit, hasSelection, hasClipboard,
    onSave, canSave, onDownload, canDownload,
    onImportRoblox, onPasteRoblox, canImport,
    onUndo, onRedo, onCopy, onPaste, onDuplicate, onDelete,
    onSelectAll, onGroup, onUngroup,
    onAddPart, onAddSpawn,
    graphics, onGraphics,
    teamOpen, onToggleTeam,
    statsOpen, onToggleStats,
    plugins, activePluginId, onTogglePlugin, onNewPlugin, mobile,
    account, onTeams,
}) {
    const [openMenu, setOpenMenu] = useState(null);
    const robloxRef = useRef(null);
    const [pop, setPop] = useState(null); // null | 'gfx' | 'stats' | 'help'
    const [stats, setStats] = useState(null);
    const [full, toggleFull] = useFullscreen();

    useEffect(() => {
        if (!openMenu && !pop) return;
        const onKey = (e) => {
            if (e.key === 'Escape') { setOpenMenu(null); setPop(null); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [openMenu, pop]);

    const showStats = () => {
        setPop('stats');
        setStats(null);
        loadStats().then(setStats).catch(() => setStats({ error: true }));
    };

    const presetNames = Object.keys(PRESETS);
    const current = presetName(graphics);
    const presetIndex = presetNames.indexOf(current);

    const noEdit = !hasMap || !canEdit;

    const MENUS = [
        ['File', [
            { label: 'Save', shortcut: 'Ctrl+S', onClick: onSave, disabled: !canSave },
            { label: 'Download .json', onClick: onDownload, disabled: !canDownload },
            SEP,
            ...(mobile ? [] : [
                { label: 'Import Roblox place...', onClick: () => robloxRef.current?.click(), disabled: !canImport },
                { label: 'Paste Roblox JSON...', onClick: onPasteRoblox, disabled: !canImport },
            ]),
        ]],
        ['Edit', [
            { label: 'Undo', shortcut: 'Ctrl+Z', onClick: onUndo, disabled: noEdit },
            { label: 'Redo', shortcut: 'Ctrl+Y', onClick: onRedo, disabled: noEdit },
            SEP,
            { label: 'Copy', shortcut: 'Ctrl+C', onClick: onCopy, disabled: !hasSelection },
            { label: 'Paste', shortcut: 'Ctrl+V', onClick: onPaste, disabled: !hasClipboard || !canEdit },
            { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: onDuplicate, disabled: !hasSelection || !canEdit },
            { label: 'Delete', shortcut: 'Delete', onClick: onDelete, disabled: !hasSelection || !canEdit },
            SEP,
            { label: 'Select all', shortcut: 'Ctrl+A', onClick: onSelectAll, disabled: !hasMap },
            { label: 'Group', shortcut: 'Ctrl+G', onClick: onGroup, disabled: !hasSelection },
            { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: onUngroup, disabled: !hasSelection },
        ]],
        ['Insert', [
            { label: 'Part', onClick: onAddPart, disabled: noEdit },
            { label: 'Spawn', onClick: onAddSpawn, disabled: noEdit },
        ]],
        ['View', [
            { label: 'Studs', checked: !!graphics.studs, onClick: () => onGraphics({ studs: !graphics.studs }) },
            { label: 'Graphics...', onClick: () => setPop('gfx') },
            { label: 'Team panel', checked: !!teamOpen, onClick: onToggleTeam, disabled: !hasMap },
            { label: 'Statistics', checked: !!statsOpen, onClick: onToggleStats },
        ]],
        ['Render', MODES.map(([value, label]) => ({
            label,
            checked: (graphics.mode ?? 'lit') === value,
            onClick: () => onGraphics({ mode: value }),
        }))],
        ...(mobile ? [] : [['Plugins', [
            ...plugins.map((p) => ({
                label: p.name,
                checked: activePluginId === p.id,
                onClick: () => onTogglePlugin(p.id),
                disabled: noEdit,
            })),
            ...(plugins.length ? [SEP] : []),
            { label: 'New plugin...', onClick: onNewPlugin, disabled: !hasMap },
        ]]]),
        ['Help', [
            { label: 'Shortcuts', onClick: () => setPop('help') },
            { label: 'Server stats', onClick: showStats },
        ]],
    ];

    return (
        <div className="menubar">
            <input
                ref={robloxRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onImportRoblox?.(file);
                }}
            />
            {MENUS.map(([title, items]) => (
                <Menu
                    key={title}
                    title={title}
                    items={items}
                    open={openMenu === title}
                    onOpen={() => setOpenMenu((m) => (m === title ? null : title))}
                    onHover={() => setOpenMenu((m) => (m ? title : m))}
                    onClose={() => setOpenMenu(null)}
                />
            ))}
            {account && (
                <button className="menu-title" onClick={onTeams}>Teams</button>
            )}
            {canFullscreen() && (
                <button
                    className="menu-title menu-full"
                    onClick={toggleFull}
                    title={full ? 'Exit fullscreen' : 'Fullscreen'}
                >
                    {full ? <Minimize size={14} /> : <Maximize size={14} />}
                </button>
            )}
            {openMenu && <div className="help-backdrop menu-backdrop" onClick={() => setOpenMenu(null)} />}
            {pop === 'gfx' && (
                <>
                    <div className="help-backdrop" onClick={() => setPop(null)} />
                    <div className="help-pop gfx-pop">
                        <ClosePop onClose={() => setPop(null)} />
                        <h3>Graphics</h3>
                        <div className="gfx-seg">
                            <span
                                className="gfx-seg-thumb"
                                style={{
                                    transform: `translateX(${Math.max(0, presetIndex) * 100}%)`,
                                    opacity: presetIndex < 0 ? 0 : 1,
                                }}
                            />
                            {presetNames.map((name) => (
                                <button
                                    key={name}
                                    className={current === name ? 'active' : ''}
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
                        <ClosePop onClose={() => setPop(null)} />
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
                        <ClosePop onClose={() => setPop(null)} />
                        <h3>Quick help</h3>
                        <h4>Camera</h4>
                        <ul>
                            <li>Hold <b>right mouse</b> to look around</li>
                            <li>While holding it: <b>WASD</b> to fly, <b>E</b> up, <b>Q</b> down, <b>Shift</b> faster</li>
                            <li><b>Middle mouse</b> pans, <b>wheel</b> zooms</li>
                            <li><b>F</b> goes to the selected part</li>
                        </ul>
                        <h4>Editing</h4>
                        <ul>
                            <li><b>Left click</b> selects a part, <b>Ctrl+click</b> adds or removes one from the selection, <b>Ctrl+A</b> selects all</li>
                            <li>Tools on keys <b>W</b> move, <b>E</b> rotate, <b>R</b> scale (or <b>1-4</b>), free while you are not flying</li>
                            <li><b>Drag a part</b> to slide it around: it rests on whatever surface is under the pointer, and <b>R</b> while dragging turns it 90°</li>
                            <li><b>Drag from empty space</b> with the Select tool to box-select, and <b>Alt+drag</b> does the same from anywhere, even starting on a part</li>
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
