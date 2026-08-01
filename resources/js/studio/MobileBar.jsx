import { Magnet, Maximize, Minimize } from 'lucide-react';
import React from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon,
    UndoIcon, RedoIcon, PartIcon, DeleteIcon, SaveIcon, PlayIcon, StopIcon, TeamIcon,
} from './icons';
import useFullscreen, { canFullscreen } from './useFullscreen';

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
    live, teamOpen, onToggleTeam, snap, setSnap,
}) {
    const snapOn = snap.moveOn && snap.rotateOn;
    const [full, toggleFull] = useFullscreen();

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
            <button
                className={`mb-btn ${snapOn ? 'active' : ''}`}
                onClick={() => setSnap({ ...snap, moveOn: !snapOn, rotateOn: !snapOn })}
                title={snapOn ? `Snapping to ${snap.move}` : 'Snapping off'}
            >
                <Magnet />
                {snapOn && <span className="mb-badge">{snap.move}</span>}
            </button>
            <span className="mb-grow" />
            <button
                className={`mb-btn ${teamOpen ? 'active' : ''} ${live ? 'is-live' : ''}`}
                onClick={onToggleTeam}
                disabled={!hasMap}
                title="Team Create"
            >
                <TeamIcon />
            </button>
            {canFullscreen() && (
                <button className="mb-btn" onClick={toggleFull} title={full ? 'Exit fullscreen' : 'Fullscreen'}>
                    {full ? <Minimize /> : <Maximize />}
                </button>
            )}
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
