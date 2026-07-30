import React from 'react';

export default function PluginPanel({ plugin, values, setValue, hasSelection, onButton, onClose }) {
    const numbers = plugin.ui.filter((c) => c.type === 'number');
    const checks = plugin.ui.filter((c) => c.type === 'checkbox');
    const buttons = plugin.ui.filter((c) => c.type === 'button');

    return (
        <div className="arch-pop">
            <div className="arch-head">
                <h3>{plugin.name}</h3>
                <button className="arch-close" onClick={onClose} title="Close">×</button>
            </div>
            {numbers.length > 0 && (
                <div className="arch-axes">
                    {numbers.map((c) => (
                        <label key={c.id}>
                            {c.label}
                            <input
                                type="number"
                                step="1"
                                value={values[c.id] ?? 0}
                                onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    if (!Number.isNaN(v)) setValue(c.id, v);
                                }}
                            />
                        </label>
                    ))}
                </div>
            )}
            {checks.map((c) => (
                <label className="arch-check" key={c.id}>
                    <input
                        type="checkbox"
                        checked={!!values[c.id]}
                        onChange={(e) => setValue(c.id, e.target.checked)}
                    />
                    {c.label}
                </label>
            ))}
            {buttons.map((c) => (
                <button
                    className="arch-stamp"
                    key={c.id}
                    onClick={() => onButton(c.id)}
                    disabled={!hasSelection}
                >
                    {c.label}
                </button>
            ))}
        </div>
    );
}
