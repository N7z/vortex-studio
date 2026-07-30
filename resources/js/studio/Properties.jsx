import React from 'react';
import NumberInput from './NumberInput';

function Vec3({ value, onChange }) {
    const set = (i) => (v) => {
        const next = [...value];
        next[i] = v;
        onChange(next);
    };
    return (
        <div className="vec3">
            {[0, 1, 2].map((i) => (
                <NumberInput key={i} value={value[i]} onChange={set(i)} />
            ))}
        </div>
    );
}

export default function Properties({ part, onChange }) {
    if (!part) {
        return (
            <div className="panel properties">
                <div className="panel-title">Properties</div>
                <div className="props"><div className="empty">Nothing selected</div></div>
            </div>
        );
    }

    return (
        <div className="panel properties">
            <div className="panel-title">Properties: {part.T}</div>
            <div className="panel-body">
                <div className="props">
                    <div className="prop-row">
                        <label>Type</label>
                        <select value={part.T} onChange={(e) => onChange({ T: e.target.value })}>
                            <option>Part</option>
                            <option>SpawnLocation</option>
                            <option>ShirtPad</option>
                            <option>Truss</option>
                        </select>
                    </div>
                    <div className="prop-row">
                        <label>Position</label>
                        <Vec3 value={part.P} onChange={(P) => onChange({ P })} />
                    </div>
                    <div className="prop-row">
                        <label>Size</label>
                        <Vec3 value={part.S} onChange={(S) => onChange({ S })} />
                    </div>
                    <div className="prop-row">
                        <label>Rotation</label>
                        <Vec3 value={part.R} onChange={(R) => onChange({ R })} />
                    </div>
                    <div className="prop-row">
                        <label>Color</label>
                        <input
                            type="color"
                            value={`#${(part.C ?? 'a3a2a5').padStart(6, '0')}`}
                            onChange={(e) => onChange({ C: e.target.value.slice(1) })}
                        />
                        <input
                            type="text"
                            value={part.C ?? ''}
                            onChange={(e) => onChange({ C: e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6) })}
                        />
                    </div>
                    <div className="prop-row">
                        <label>Transparency</label>
                        <NumberInput
                            value={part.Tr ?? 0}
                            clamp={(v) => Math.min(1, Math.max(0, v))}
                            onChange={(Tr) => onChange({ Tr })}
                        />
                    </div>
                    {'ItemId' in part && (
                        <div className="prop-row">
                            <label>ItemId</label>
                            <input
                                type="number"
                                value={part.ItemId ?? ''}
                                onChange={(e) => onChange({ ItemId: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
