import React, { useState } from 'react';
import {
    SelectIcon, MoveIcon, RotateIcon, ScaleIcon, PartIcon, SpawnIcon,
    CopyIcon, PasteIcon, DuplicateIcon, SaveIcon, DownloadIcon, HelpIcon, StatsIcon,
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
    const [helpOpen, setHelpOpen] = useState(false);

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
            <div className="group help-group">
                <a className="tool-btn" href="/stats" target="_blank" rel="noreferrer">
                    <StatsIcon />
                    Stats
                </a>
                <button className="tool-btn" onClick={() => setHelpOpen((o) => !o)}>
                    <HelpIcon />
                    Help
                </button>
            </div>
            {helpOpen && (
                <>
                    <div className="help-backdrop" onClick={() => setHelpOpen(false)} />
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
