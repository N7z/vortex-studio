import React, { useEffect, useRef, useState } from 'react';
import NumberInput from './NumberInput';
import { LOG_STEPS, logToValue, valueToLog } from './scale';
import {
    FACES, MATERIALS, TEXTURES,
    canCollide, castsShadow, isAnchored, isBaseplate, materialOf, texturesOf,
} from './materials';
import {
    AMBIENT, DEFAULT_POINT_LIGHT, DEFAULT_SPOT_LIGHT, LIGHT_FACES, MAX_BRIGHTNESS,
    MAX_ILLUMINANCE, MAX_INTENSITY, MAX_RANGE, pointLightOf, spotLightOf,
} from './lighting';

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
    value, min, max, step, readOnly, onChange, log = false,
}) {
    return (
        <div className="prop-slider">
            {log ? (
                <input
                    type="range"
                    min={0}
                    max={LOG_STEPS}
                    step={1}
                    value={valueToLog(value, max)}
                    disabled={readOnly}
                    onChange={(e) => onChange(logToValue(Number(e.target.value), max))}
                />
            ) : (
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={readOnly}
                onChange={(e) => onChange(Number(e.target.value))}
            />
            )}
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

function AmbientProperties({ lighting, onChange, readOnly }) {
    return (
        <div className="panel properties">
            <div className="panel-title">
                Properties: Ambient
                {readOnly && <span className="props-ro">read only</span>}
            </div>
            <div className="panel-body">
                <div className="props">
                    <ColorRow
                        id="ambient"
                        value={lighting.ambient_color}
                        readOnly={readOnly}
                        onCommit={(ambient_color) => onChange({ ambient_color })}
                    />
                    <div className="prop-row">
                        <label>Brightness</label>
                        <Slider
                            log
                            value={lighting.brightness}
                            min={0}
                            max={MAX_BRIGHTNESS}
                            step={5}
                            readOnly={readOnly}
                            onChange={(brightness) => onChange({ brightness })}
                        />
                    </div>
                    <div className="prop-note">
                        Light with no direction, filling the shadows the sun leaves.
                    </div>
                </div>
            </div>
        </div>
    );
}

function SunProperties({ lighting, onChange, readOnly }) {
    return (
        <div className="panel properties">
            <div className="panel-title">
                Properties: Sun
                {readOnly && <span className="props-ro">read only</span>}
            </div>
            <div className="panel-body">
                <div className="props">
                    <div className="prop-row">
                        <label>Rotation</label>
                        <Vec3
                            value={lighting.sun_rotation}
                            readOnly={readOnly}
                            onChange={(sun_rotation) => onChange({ sun_rotation })}
                        />
                    </div>
                    <ColorRow
                        id="sun"
                        value={lighting.sun_color}
                        readOnly={readOnly}
                        onCommit={(sun_color) => onChange({ sun_color })}
                    />
                    <div className="prop-row">
                        <label>Illuminance</label>
                        <Slider
                            log
                            value={lighting.sun_illuminance}
                            min={0}
                            max={MAX_ILLUMINANCE}
                            step={100}
                            readOnly={readOnly}
                            onChange={(sun_illuminance) => onChange({ sun_illuminance })}
                        />
                    </div>
                    <Toggle
                        label="Shadows"
                        checked={lighting.sun_shadow_maps_enabled !== false}
                        readOnly={readOnly}
                        onChange={(sun_shadow_maps_enabled) => onChange({ sun_shadow_maps_enabled })}
                    />
                </div>
            </div>
        </div>
    );
}

function PartLightProperties({
    part, kind, onChange, readOnly, onRemove,
}) {
    const spot = kind === 'spot';
    const light = spot ? spotLightOf(part) : pointLightOf(part);
    if (!light) return null;
    const key = spot ? 'spot_light' : 'point_light';
    const set = (patch) => onChange({ [key]: { ...light, ...patch } });

    return (
        <div className="panel properties">
            <div className="panel-title">
                Properties: {spot ? 'SpotLight' : 'PointLight'}
                {readOnly && <span className="props-ro">read only</span>}
            </div>
            <div className="panel-body">
                <div className="props">
                    <ColorRow
                        id={`${key}:${part._id}`}
                        value={light.color}
                        readOnly={readOnly}
                        onCommit={(color) => set({ color })}
                    />
                    <div className="prop-row">
                        <label>Intensity</label>
                        <Slider
                            log
                            value={light.intensity}
                            min={0}
                            max={MAX_INTENSITY}
                            step={1000}
                            readOnly={readOnly}
                            onChange={(intensity) => set({ intensity })}
                        />
                    </div>
                    <div className="prop-row">
                        <label>Range</label>
                        <Slider
                            value={light.range}
                            min={0}
                            max={MAX_RANGE}
                            step={1}
                            readOnly={readOnly}
                            onChange={(range) => set({ range })}
                        />
                    </div>
                    {spot && (
                        <>
                            <div className="prop-row">
                                <label>Angle</label>
                                <Slider
                                    value={light.angle}
                                    min={1}
                                    max={89}
                                    step={1}
                                    readOnly={readOnly}
                                    onChange={(angle) => set({ angle })}
                                />
                            </div>
                            <div className="prop-row">
                                <label>Face</label>
                                <select
                                    value={light.face}
                                    disabled={readOnly}
                                    onChange={(e) => set({ face: e.target.value })}
                                >
                                    {LIGHT_FACES.map((f) => <option key={f}>{f}</option>)}
                                </select>
                            </div>
                        </>
                    )}
                    <Toggle
                        label="Shadows"
                        checked={light.shadow_maps_enabled === true}
                        readOnly={readOnly}
                        onChange={(shadow_maps_enabled) => set({ shadow_maps_enabled })}
                    />
                    <div className="prop-note">
                        It shines from the part that holds it, so moving the part moves the light.
                    </div>
                    {!readOnly && (
                        <button className="prop-remove" onClick={() => onRemove(key)}>
                            Remove this light
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function Properties({
    part, count = 0, onChange, readOnly = false, light = null, lighting = null, onLightChange = null,
    partLight = null,
}) {
    const id = part?._id ?? null;
    const [draft, setColorDraft] = useColorDraft(id, (hex) => onChange({ C: hex }));

    if (partLight && part) {
        return (
            <PartLightProperties
                part={part}
                kind={partLight}
                onChange={onChange}
                readOnly={readOnly}
                onRemove={(key) => onChange({ [key]: null })}
            />
        );
    }

    if (light && lighting) {
        const Panel = light === AMBIENT ? AmbientProperties : SunProperties;

        return <Panel lighting={lighting} onChange={onLightChange} readOnly={readOnly} />;
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
