import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput';
import {
    FACES, MATERIALS, TEXTURES,
    canCollide, castsShadow, isAnchored, isBaseplate, materialOf, texturesOf,
} from './materials';
import { MAX_ILLUMINANCE } from './lighting';

const COLOR_COMMIT = 150;

function Vec3({ value, onChange, readOnly }) {
    const set = (i) => (v) => {
        const next = [...value];
        next[i] = v;
        onChange(next);
    };
    return (
        <div className="vec3">
            {[0, 1, 2].map((i) => (
                <NumberInput key={i} value={value[i]} onChange={set(i)} readOnly={readOnly} />
            ))}
        </div>
    );
}

// A number that has a floor and a ceiling is easier to feel out by dragging than by typing, so it
// gets both: the slider to sweep it and the box to land on an exact value.
function Slider({
    value, min, max, step, readOnly, onChange,
}) {
    return (
        <div className="prop-slider">
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={readOnly}
                onChange={(e) => onChange(Number(e.target.value))}
            />
            <NumberInput
                value={value}
                readOnly={readOnly}
                clamp={(v) => Math.min(max, Math.max(min, v))}
                onChange={onChange}
            />
        </div>
    );
}

function Toggle({ label, checked, readOnly, onChange }) {
    return (
        <div className="prop-row prop-check">
            <label>{label}</label>
            <input
                type="checkbox"
                checked={checked}
                disabled={readOnly}
                onChange={(e) => onChange(e.target.checked)}
            />
        </div>
    );
}

function useColorDraft(id, commit) {
    const [draft, setDraft] = useState(null);
    const timer = useRef(0);

    useEffect(() => {
        clearTimeout(timer.current);
        setDraft(null);
    }, [id]);

    useEffect(() => () => clearTimeout(timer.current), []);

    return [draft, (hex) => {
        setDraft(hex);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            setDraft(null);
            commit(hex);
        }, COLOR_COMMIT);
    }];
}

function ColorRow({ id, value, readOnly, onCommit }) {
    const [draft, setDraft] = useColorDraft(id, onCommit);

    return (
        <div className="prop-row">
            <label>Color</label>
            <input
                type="color"
                disabled={readOnly}
                value={`#${(draft ?? value ?? 'a3a2a5').padStart(6, '0')}`}
                onChange={(e) => setDraft(e.target.value.slice(1))}
            />
            <input
                type="text"
                value={draft ?? value ?? ''}
                readOnly={readOnly}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))}
            />
        </div>
    );
}

function LightProperties({ light, onChange, readOnly }) {
    return (
        <div className="panel properties">
            <div className="panel-title">
                Properties: {light.N}
                {readOnly && <span className="props-ro">read only</span>}
            </div>
            <div className="panel-body">
                <div className="props">
                    <div className="prop-row">
                        <label>Name</label>
                        <input
                            type="text"
                            value={light.N}
                            readOnly={readOnly}
                            onChange={(e) => onChange({ N: e.target.value.slice(0, 64) || 'Light' })}
                        />
                    </div>
                    <div className="prop-row">
                        <label>Position</label>
                        <Vec3 value={light.P} readOnly={readOnly} onChange={(P) => onChange({ P })} />
                    </div>
                    <div className="prop-row">
                        <label>Rotation</label>
                        <Vec3 value={light.R} readOnly={readOnly} onChange={(R) => onChange({ R })} />
                    </div>
                    <ColorRow
                        id={light._id}
                        value={light.C}
                        readOnly={readOnly}
                        onCommit={(C) => onChange({ C })}
                    />
                    <div className="prop-row">
                        <label>Illuminance</label>
                        <Slider
                            value={light.I}
                            min={0}
                            max={MAX_ILLUMINANCE}
                            step={100}
                            readOnly={readOnly}
                            onChange={(I) => onChange({ I })}
                        />
                    </div>
                    <Toggle
                        label="Shadows"
                        checked={light.Sd !== false}
                        readOnly={readOnly}
                        onChange={(Sd) => onChange({ Sd })}
                    />
                </div>
            </div>
        </div>
    );
}

export default function Properties({
    part, count = 0, onChange, readOnly = false, light = null, onLightChange = null,
}) {
    const id = part?._id ?? null;
    const [draft, setColorDraft] = useColorDraft(id, (hex) => onChange({ C: hex }));

    if (light) {
        return <LightProperties light={light} onChange={onLightChange} readOnly={readOnly} />;
    }

    if (!part) {
        return (
            <div className="panel properties">
                <div className="panel-title">Properties</div>
                <div className="props">
                    <div className="empty">
                        <img src="/img/fluttershy.webp" alt="" width="512" height="512" />
                        Nothing selected
                    </div>
                </div>
            </div>
        );
    }

    const textures = texturesOf(part);
    const setFace = (face, kind) => {
        const next = { ...textures };
        if (kind) next[face] = kind;
        else delete next[face];
        onChange({ Tx: next });
    };

    return (
        <div className="panel properties">
            <div className="panel-title">
                {count > 1 ? `Properties: ${count} selected` : `Properties: ${part.T}`}
                {readOnly && <span className="props-ro">read only</span>}
            </div>
            <div className="panel-body">
                <div className="props">
                    <div className="prop-row">
                        <label>Type</label>
                        <select value={part.T} disabled={readOnly} onChange={(e) => onChange({ T: e.target.value })}>
                            <option>Part</option>
                            <option>SpawnLocation</option>
                            <option>ShirtPad</option>
                            <option>Truss</option>
                        </select>
                    </div>
                    <div className="prop-row">
                        <label>Position</label>
                        <Vec3 value={part.P} readOnly={readOnly} onChange={(P) => onChange({ P })} />
                    </div>
                    <div className="prop-row">
                        <label>Size</label>
                        <Vec3 value={part.S} readOnly={readOnly} onChange={(S) => onChange({ S })} />
                    </div>
                    <div className="prop-row">
                        <label>Rotation</label>
                        <Vec3 value={part.R} readOnly={readOnly} onChange={(R) => onChange({ R })} />
                    </div>

                    <div className="prop-head">Appearance</div>
                    <div className="prop-row">
                        <label>Color</label>
                        <input
                            type="color"
                            disabled={readOnly}
                            value={`#${(draft ?? part.C ?? 'a3a2a5').padStart(6, '0')}`}
                            onChange={(e) => setColorDraft(e.target.value.slice(1))}
                        />
                        <input
                            type="text"
                            value={draft ?? part.C ?? ''}
                            readOnly={readOnly}
                            onChange={(e) => setColorDraft(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))}
                        />
                    </div>
                    <div className="prop-row">
                        <label>Transparency</label>
                        <Slider
                            value={part.Tr ?? 0}
                            min={0}
                            max={1}
                            step={0.05}
                            readOnly={readOnly}
                            onChange={(Tr) => onChange({ Tr })}
                        />
                    </div>
                    <div className="prop-row">
                        <label>Material</label>
                        <select
                            value={materialOf(part)}
                            disabled={readOnly}
                            onChange={(e) => onChange({ M: e.target.value })}
                        >
                            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                    </div>
                    <Toggle
                        label="Cast Shadow"
                        checked={castsShadow(part)}
                        readOnly={readOnly}
                        onChange={(Cs) => onChange({ Cs })}
                    />

                    <div className="prop-head">Behavior</div>
                    <Toggle
                        label="Anchored"
                        checked={isAnchored(part)}
                        readOnly={readOnly}
                        onChange={(An) => onChange({ An })}
                    />
                    <Toggle
                        label="CanCollide"
                        checked={canCollide(part)}
                        readOnly={readOnly}
                        onChange={(Cc) => onChange({ Cc })}
                    />
                    <Toggle
                        label="Truss"
                        checked={part.T === 'Truss'}
                        readOnly={readOnly}
                        onChange={(on) => onChange({ T: on ? 'Truss' : 'Part' })}
                    />
                    <Toggle
                        label="Baseplate"
                        checked={isBaseplate(part)}
                        readOnly={readOnly}
                        onChange={(Bp) => onChange({ Bp })}
                    />

                    <div className="prop-head">Textures</div>
                    {FACES.map((face) => (
                        <div className="prop-row" key={face}>
                            <label>{face}</label>
                            <select
                                value={textures[face] ?? ''}
                                disabled={readOnly}
                                onChange={(e) => setFace(face, e.target.value)}
                            >
                                <option value="">None</option>
                                {TEXTURES.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                        </div>
                    ))}

                    {'ItemId' in part && (
                        <div className="prop-row">
                            <label>ItemId</label>
                            <input
                                type="number"
                                value={part.ItemId ?? ''}
                                readOnly={readOnly}
                                onChange={(e) => onChange({ ItemId: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
