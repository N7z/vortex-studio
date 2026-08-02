import React, { useRef } from 'react';
import { PencilIcon } from './icons';
import NumberInput from './NumberInput';
import useDraggable from './useDraggable';

export default function PluginPanel({
    plugin, values, setValue, images, onImage, models, onModel,
    hasSelection, targetNote, onButton, onEdit, onClose, resCap = Infinity,
}) {
    const pickers = useRef({});
    const { style, onPointerDown } = useDraggable('plugin');
    const texts = plugin.ui.filter((c) => c.type === 'text');
    const swatches = plugin.ui.filter((c) => c.type === 'color');
    const numbers = plugin.ui.filter((c) => c.type === 'number');
    const checks = plugin.ui.filter((c) => c.type === 'checkbox');
    const buttons = plugin.ui.filter((c) => c.type === 'button');
    const pictures = plugin.ui.filter((c) => c.type === 'image');
    const shapes = plugin.ui.filter((c) => c.type === 'model');
    const capped = new Set(shapes.map((c) => c.res).filter(Boolean));

    return (
        <div className="arch-pop" style={style}>
            <div className="arch-head" onPointerDown={onPointerDown}>
                <h3>{plugin.name}</h3>
                {plugin.version && <span className="arch-ver">v{plugin.version}</span>}
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
            {shapes.map((c) => {
                const info = models?.[c.id] ?? null;
                return (
                    <div className="arch-image" key={c.id}>
                        <input
                            type="file"
                            accept=".glb,.gltf,.obj"
                            ref={(el) => { pickers.current[c.id] = el; }}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onModel(c.id, file);
                                e.target.value = '';
                            }}
                        />
                        <button onClick={() => pickers.current[c.id]?.click()}>
                            {info ? 'Choose another model' : `Choose ${c.label.toLowerCase()}...`}
                        </button>
                        {info && (
                            <div className="arch-model-info">
                                <span className="name" title={info.name}>{info.name}</span>
                                <span className="dim">
                                    {info.w}×{info.h}×{info.d}, {info.count.toLocaleString()} blocks
                                </span>
                                <span className="dim">
                                    {info.source === 'texture' && 'coloured from its texture'}
                                    {info.source === 'vertex' && 'coloured from its vertex colours'}
                                    {info.source !== 'texture' && info.source !== 'vertex'
                                        && 'no texture or vertex colours: one flat colour'}
                                </span>
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
            {swatches.map((c) => (
                <label className="arch-color" key={c.id}>
                    {c.label}
                    <input
                        type="color"
                        value={`#${String(values[c.id] ?? '').replace(/^#/, '') || '000000'}`}
                        onChange={(e) => setValue(c.id, e.target.value.slice(1))}
                    />
                </label>
            ))}
            {numbers.length > 0 && (
                <div className="arch-axes">
                    {numbers.map((c) => {
                        const cap = capped.has(c.id) && Number.isFinite(resCap) ? resCap : null;
                        return (
                            <label key={c.id} title={cap ? `${c.label}, up to ${cap}` : c.label}>
                                {cap ? `${c.label} (max ${cap})` : c.label}
                                <NumberInput
                                    value={values[c.id] ?? 0}
                                    clamp={cap ? (v) => Math.min(Math.max(Math.round(v), 4), cap) : undefined}
                                    onChange={(v) => setValue(c.id, v)}
                                />
                            </label>
                        );
                    })}
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
