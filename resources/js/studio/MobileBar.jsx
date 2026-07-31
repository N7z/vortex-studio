import React from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon,
    UndoIcon, RedoIcon, PartIcon, DeleteIcon, SaveIcon, PlayIcon, StopIcon,
} from './icons';

const TOOLS = [
    ['select', SelectIcon],
    ['move', MoveIcon],
    ['rotate', RotateIcon],
    ['scale', ScaleIcon],
];

export default function MobileBar({
    tool, setTool, hasSelection, canEdit,
    onUndo, onRedo, onAddPart, onDelete,
    onSave, canSave, hasMap, playing, onPlay, onStop,
}) {
    return (
        <div className="mobilebar">
            {TOOLS.map(([id, Icon]) => (
                <button
                    key={id}
                    className={`mb-btn ${tool === id ? 'active' : ''}`}
                    onClick={() => setTool(id)}
                    title={id}
                >
                    <Icon />
                </button>
            ))}
            <span className="mb-sep" />
            <button className="mb-btn" onClick={onUndo} disabled={!canEdit} title="Undo"><UndoIcon /></button>
            <button className="mb-btn" onClick={onRedo} disabled={!canEdit} title="Redo"><RedoIcon /></button>
            <button className="mb-btn" onClick={onAddPart} disabled={!hasMap || !canEdit} title="Add part">
                <PartIcon />
            </button>
            <button className="mb-btn" onClick={onDelete} disabled={!hasSelection || !canEdit} title="Delete">
                <DeleteIcon />
            </button>
            <span className="mb-grow" />
            <button
                className={`mb-btn ${playing ? 'active' : ''}`}
                onClick={playing ? onStop : onPlay}
                disabled={!hasMap}
                title={playing ? 'Stop' : 'Play'}
            >
                {playing ? <StopIcon /> : <PlayIcon />}
            </button>
            <button className="mb-btn" onClick={onSave} disabled={!canSave} title="Save"><SaveIcon /></button>
        </div>
    );
}
