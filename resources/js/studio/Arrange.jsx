import React, { useState } from 'react';
import NumberInput from './NumberInput';
import { alignUpdates, distributeUpdates, dropUpdates, spaceUpdates } from './align';

const AXES = [['X', 0], ['Y', 1], ['Z', 2]];
const MODES = [['Min', 'min'], ['Center', 'center'], ['Max', 'max']];

export default function Arrange({ selected, parts, onTransform, readOnly = false }) {
    const [gap, setGap] = useState(0);
    const count = selected.length;
    const run = (updates) => { if (updates.length) onTransform(updates); };
    const off = readOnly || count < 2;

    return (
        <div className="panel arrange">
            <div className="panel-title">Arrange{count > 1 ? `: ${count} selected` : ''}</div>
            <div className="panel-body">
                <div className="arrange-grid">
                    {AXES.map(([label, axis]) => (
                        <div className="arrange-row" key={label}>
                            <span className="arrange-axis">{label}</span>
                            {MODES.map(([text, mode]) => (
                                <button
                                    key={mode}
                                    disabled={off}
                                    title={`Align ${label} ${text.toLowerCase()}`}
                                    onClick={() => run(alignUpdates(selected, axis, mode))}
                                >
                                    {text}
                                </button>
                            ))}
                            <button
                                disabled={off || count < 3}
                                title={count < 3 ? 'Needs three parts' : `Even gaps along ${label}`}
                                onClick={() => run(distributeUpdates(selected, axis))}
                            >
                                Spread
                            </button>
                        </div>
                    ))}
                </div>

                <div className="arrange-gap">
                    <span>Gap</span>
                    <NumberInput value={gap} onChange={setGap} readOnly={readOnly} />
                    {AXES.map(([label, axis]) => (
                        <button
                            key={label}
                            disabled={off}
                            title={`Line them up along ${label} with a ${gap} stud gap`}
                            onClick={() => run(spaceUpdates(selected, axis, gap))}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <button
                    className="arrange-drop"
                    disabled={readOnly || !count}
                    title="Drop each part onto whatever is under it"
                    onClick={() => run(dropUpdates(selected, parts))}
                >
                    Drop to surface
                </button>
            </div>
        </div>
    );
}
