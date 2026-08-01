import React from 'react';
import UserMenu from './UserMenu';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon, TeamIcon,
    UndoIcon, RedoIcon, PartIcon, SpawnIcon, CopyIcon, PasteIcon, DuplicateIcon,
    DeleteIcon, SaveIcon, StudsIcon, PlayIcon, StopIcon,
} from './icons';

const TOOLS = [
    ['select', 'Select', SelectIcon],
    ['move', 'Move', MoveIcon],
    ['rotate', 'Rotate', RotateIcon],
    ['scale', 'Scale', ScaleIcon],
];

function Group({ label, className = '', children }) {
    return (
        <div className={`group ${className}`.trim()}>
            <span className="group-label">{label}</span>
            <div className="group-items">{children}</div>
        </div>
    );
}

export default function Toolbar({
    tool, setTool, snap, setSnap,
    hasSelection, hasClipboard, canEdit,
    onUndo, onRedo, onAddPart, onAddSpawn,
    onCopy, onPaste, onDuplicate, onDelete,
    onSave, canSave, graphics, onGraphics,
    live, teamOpen, onToggleTeam, hasMap,
    playing, onPlay, onStop,
    account, ttl, claimed, onAccountChange,
}) {
    const numInput = (key) => (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v) && v > 0) setSnap({ ...snap, [key]: v });
    };

    return (
        <div className="toolbar">
            <Group label="Tools">
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
            </Group>
            <Group label="Snap" className="snap-group">
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
            </Group>
            <Group label="History">
                <button className="tool-btn" onClick={onUndo} disabled={!hasMap || !canEdit} title="Ctrl+Z">
                    <UndoIcon />
                    Undo
                </button>
                <button className="tool-btn" onClick={onRedo} disabled={!hasMap || !canEdit} title="Ctrl+Y">
                    <RedoIcon />
                    Redo
                </button>
            </Group>
            <Group label="Insert">
                <button className="tool-btn" onClick={onAddPart} disabled={!hasMap || !canEdit}>
                    <PartIcon />
                    Part
                </button>
                <button className="tool-btn" onClick={onAddSpawn} disabled={!hasMap || !canEdit}>
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
            </Group>
            <Group label="Edit">
                <button className="tool-btn" onClick={onCopy} disabled={!hasSelection} title="Ctrl+C">
                    <CopyIcon />
                    Copy
                </button>
                <button className="tool-btn" onClick={onPaste} disabled={!hasClipboard || !canEdit} title="Ctrl+V">
                    <PasteIcon />
                    Paste
                </button>
                <button className="tool-btn" onClick={onDuplicate} disabled={!hasSelection || !canEdit} title="Ctrl+D">
                    <DuplicateIcon />
                    Duplicate
                </button>
                <button className="tool-btn" onClick={onDelete} disabled={!hasSelection || !canEdit} title="Delete">
                    <DeleteIcon />
                    Delete
                </button>
            </Group>
            <Group label="Test">
                <button
                    className="tool-btn play-btn"
                    onClick={onPlay}
                    disabled={!hasMap || playing}
                    title="Walk around this map (F6)"
                >
                    <PlayIcon />
                    Play
                </button>
                <button
                    className="tool-btn stop-btn"
                    onClick={onStop}
                    disabled={!playing}
                    title="Back to editing (Escape)"
                >
                    <StopIcon />
                    Stop
                </button>
            </Group>
            <Group label="Map">
                <button className="tool-btn" onClick={onSave} disabled={!canSave} title="Ctrl+S">
                    <SaveIcon />
                    Save
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
            </Group>
            <Group label="Account" className="account-group">
                <UserMenu account={account} ttl={ttl} onChange={onAccountChange} claimed={claimed} />
            </Group>
        </div>
    );
}
