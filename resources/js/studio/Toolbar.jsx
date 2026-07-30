import React from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon, TeamIcon,
    UndoIcon, RedoIcon, PartIcon, SpawnIcon, CopyIcon, PasteIcon, DuplicateIcon,
    DeleteIcon, SaveIcon, StudsIcon,
} from './icons';

const TOOLS = [
    ['select', 'Select', SelectIcon],
    ['move', 'Move', MoveIcon],
    ['rotate', 'Rotate', RotateIcon],
    ['scale', 'Scale', ScaleIcon],
];

export default function Toolbar({
    tool, setTool, snap, setSnap,
    hasSelection, hasClipboard, canEdit,
    onUndo, onRedo, onAddPart, onAddSpawn,
    onCopy, onPaste, onDuplicate, onDelete,
    onSave, canSave, graphics, onGraphics,
    live, teamOpen, onToggleTeam, hasMap,
}) {
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
                <button className="tool-btn" onClick={onUndo} disabled={!hasMap || !canEdit} title="Ctrl+Z">
                    <UndoIcon />
                    Undo
                </button>
                <button className="tool-btn" onClick={onRedo} disabled={!hasMap || !canEdit} title="Ctrl+Y">
                    <RedoIcon />
                    Redo
                </button>
            </div>
            <div className="group">
                <button className="tool-btn" onClick={onAddPart} disabled={!hasMap || !canEdit}>
                    <PartIcon />
                    Part
                </button>
                <button className="tool-btn" onClick={onAddSpawn} disabled={!hasMap || !canEdit}>
                    <SpawnIcon />
                    Spawn
                </button>
            </div>
            <div className="group">
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
            </div>
            <div className="group">
                <button className="tool-btn" onClick={onSave} disabled={!canSave} title="Ctrl+S">
                    <SaveIcon />
                    Save
                </button>
                <button
                    className={`tool-btn ${graphics.studs ? 'active' : ''}`}
                    onClick={() => onGraphics({ studs: !graphics.studs })}
                    title="Show stud textures on top faces"
                >
                    <StudsIcon />
                    Studs
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
        </div>
    );
}
