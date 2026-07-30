import React, { useRef } from 'react';
import { PencilIcon } from './icons';
import NumberInput from './NumberInput';
import useDraggable from './useDraggable';

export default function PluginPanel({
    plugin, values, setValue, images, onImage, hasSelection, targetNote, onButton, onEdit, onClose,
}) {
    const pickers = useRef({});
    const { style, onPointerDown } = useDraggable('plugin');
    const texts = plugin.ui.filter((c) => c.type === 'text');
    const numbers = plugin.ui.filter((c) => c.type === 'number');
    const checks = plugin.ui.filter((c) => c.type === 'checkbox');
    const buttons = plugin.ui.filter((c) => c.type === 'button');
    const pictures = plugin.ui.filter((c) => c.type === 'image');

    return (
        <div className="arch-pop" style={style}>
            <div className="arch-head" onPointerDown={onPointerDown}>
                <h3>{plugin.name}</h3>
                <button className="arch-edit" onClick={onEdit} title="Edit plugin script">
                    <PencilIcon />
                </button>
                <button className="arch-close" onClick={onClose} title="Close">×</button>
            </div>
            {pictures.map((c) => {
                const img = images?.[c.id] ?? null;
                return (
                    <div className="arch-image" key={c.id}>
                        <input
                            type="file"
                            accept="image/*"
                            ref={(el) => { pickers.current[c.id] = el; }}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onImage(c.id, file);
                                e.target.value = '';
                            }}
                        />
                        <button onClick={() => pickers.current[c.id]?.click()}>
                            {img ? 'Choose another image' : `Choose ${c.label.toLowerCase()}...`}
                        </button>
                        {img && (
                            <div className="arch-image-info">
                                <img src={img.url} alt={img.name} />
                                <div>
                                    <span className="name" title={img.name}>{img.name}</span>
                                    <span className="dim">{img.srcW}×{img.srcH}</span>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
            {texts.map((c) => (
                <label className="arch-text" key={c.id}>
                    {c.label}
                    <input
                        type="text"
                        value={values[c.id] ?? ''}
                        maxLength={c.max ?? 64}
                        onChange={(e) => setValue(c.id, e.target.value)}
                    />
                </label>
            ))}
            {numbers.length > 0 && (
                <div className="arch-axes">
                    {numbers.map((c) => (
                        <label key={c.id}>
                            {c.label}
                            <NumberInput
                                value={values[c.id] ?? 0}
                                onChange={(v) => setValue(c.id, v)}
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
                    title={targetNote ?? undefined}
                >
                    {c.label}
                </button>
            ))}
            {targetNote && <div className="arch-note">{targetNote}</div>}
        </div>
    );
}
