import React from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon, PartIcon, SpawnIcon,
    CopyIcon, PasteIcon, DuplicateIcon, SaveIcon, DownloadIcon,
} from './icons';

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
                <button className="tool-btn" onClick={onAddPart}>
                    <PartIcon />
                    Part
                </button>
                <button className="tool-btn" onClick={onAddSpawn}>
                    <SpawnIcon />
                    Spawn
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
        </div>
    );
}
