import React, { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { TrashIcon, RotateIcon, HelpIcon } from './icons';
import { ICON_NAMES } from './pluginIcons';

export const TEMPLATE = `plugin = {
    name = "My Plugin",
    icon = Icons.Box,
    ui = {
        { id = "dy", type = "number", label = "Lift", default = 5 },
        { id = "place", type = "button", label = "Place copy above" },
    },
}

function plugin.preview(part, values)
    local out = {}
    for k, v in pairs(part) do
        out[k] = v
    end
    out.P = { part.P[1], part.P[2] + values.dy, part.P[3] }
    return out
end

function plugin.click(id, part, values)
    if id == "place" then
        return plugin.preview(part, values)
    end
end
`;

const kw = (label) => ({ label, type: 'keyword' });
const fn = (label, info) => ({ label, type: 'function', info });
const prop = (label, info) => ({ label, type: 'property', info });

const COMPLETIONS = [
    ...['local', 'function', 'end', 'if', 'then', 'else', 'elseif', 'return', 'for', 'while',
        'do', 'repeat', 'until', 'in', 'and', 'or', 'not', 'true', 'false', 'nil', 'break'].map(kw),
    prop('plugin', 'global table describing this plugin'),
    prop('plugin.name', 'display name shown in the toolbar'),
    prop('plugin.icon', 'any lucide icon, e.g. Icons.DraftingCompass'),
    prop('Icons', 'every lucide icon: Icons.Box, Icons.Spline, ...'),
    prop('plugin.ui', 'list of controls: number, checkbox, button, image'),
    fn('plugin.preview(part, values)', 'return the ghost part shown while a part is selected'),
    fn('plugin.click(id, part, values)', 'button handler; return a part, or a list of parts'),
    fn('json.decode(s)', 'parse a JSON string into a table'),
    prop('Image', 'the picked image, or nil: Image.w, Image.h, Image.pixel(x, y)'),
    fn('Image.pixel(x, y)', '0-based, top-left origin; returns "rrggbb", alpha 0-255'),
    prop('part.P', 'position {x, y, z}'),
    prop('part.S', 'size {x, y, z}'),
    prop('part.R', 'rotation in degrees {x, y, z}'),
    prop('part.C', 'hex color string, no #'),
    prop('part.T', 'part type: Part, SpawnLocation, ShirtPad, Truss'),
    prop('part.Tr', 'transparency 0..1'),
    ...['math.rad', 'math.deg', 'math.sin', 'math.cos', 'math.tan', 'math.asin', 'math.acos',
        'math.atan', 'math.sqrt', 'math.abs', 'math.floor', 'math.ceil', 'math.min', 'math.max',
        'math.pi', 'math.huge', 'math.random'].map((l) => fn(l)),
    ...['table.insert', 'table.remove', 'table.concat', 'table.unpack', 'table.sort'].map((l) => fn(l)),
    ...['string.format', 'string.sub', 'string.rep', 'string.len', 'string.upper', 'string.lower',
        'pairs', 'ipairs', 'tostring', 'tonumber', 'type', 'select', 'error', 'pcall'].map((l) => fn(l)),
    {
        label: 'uicontrol',
        type: 'keyword',
        detail: 'snippet',
        apply: '{ id = "value", type = "number", label = "Value", default = 0 },',
        info: 'insert a ui control entry',
    },
];

const ICON_OPTIONS = ICON_NAMES.map((n) => ({ label: n, type: 'variable' }));

function iconComplete(context) {
    const m = context.matchBefore(/Icons\.\w*/);
    if (!m) return null;
    return { from: m.from + 'Icons.'.length, options: ICON_OPTIONS, validFor: /^\w*$/ };
}

function luaComplete(context) {
    if (context.matchBefore(/Icons\.\w*/)) return null;
    const word = context.matchBefore(/[\w.]+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return { from: word.from, options: COMPLETIONS, validFor: /^[\w.]*$/ };
}

const BASE_EXTENSIONS = [
    StreamLanguage.define(lua),
    autocompletion({ override: [iconComplete, luaComplete], maxRenderedOptions: 60 }),
];

export default function ScriptTab({ tab, visible, onChange, onSave, onDelete, onReset }) {
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [help, setHelp] = useState(false);

    const save = async () => {
        setBusy(true);
        const err = await onSave();
        setBusy(false);
        setError(err);
    };

    const extensions = useMemo(() => [
        ...BASE_EXTENSIONS,
        Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { save(); return true; } }])),
    ], [onSave]);

    const reset = async () => {
        setBusy(true);
        const err = await onReset();
        setBusy(false);
        setError(err);
    };

    return (
        <div className="script-tab" style={visible ? undefined : { display: 'none' }}>
            <div className="script-bar">
                <button className="arch-stamp script-save" onClick={save} disabled={busy}>
                    {busy ? 'Loading...' : 'Save & load'}
                </button>
                {tab.pluginId && (tab.builtin ? (
                    <button className="script-reset" onClick={reset} disabled={busy} title="Restore the original script">
                        <RotateIcon />
                    </button>
                ) : confirming ? (
                    <div className="script-confirm">
                        <span>Delete {tab.title}?</span>
                        <button className="script-confirm-yes" onClick={onDelete}>Delete</button>
                        <button className="script-confirm-no" onClick={() => setConfirming(false)}>Cancel</button>
                    </div>
                ) : (
                    <button className="plug-edit-delete" onClick={() => setConfirming(true)} title="Delete plugin">
                        <TrashIcon />
                    </button>
                ))}
                {error && <div className="plug-edit-error script-error">{error}</div>}
                <button
                    className={`script-help-btn ${help ? 'on' : ''}`}
                    onClick={() => setHelp((h) => !h)}
                    title="Scripting help"
                >
                    <HelpIcon />
                </button>
            </div>
            <div className="script-body">
                <div className="script-editor">
                    <CodeMirror
                        value={tab.src}
                        onChange={(v) => { onChange(v); setError(null); }}
                        extensions={extensions}
                        theme={oneDark}
                        height="100%"
                        basicSetup={{ autocompletion: false, tabSize: 4 }}
                    />
                </div>
                {help && <ScriptHelp />}
            </div>
        </div>
    );
}

function ScriptHelp() {
    return (
        <div className="script-help">
            <h4>The plugin table</h4>
            <p>
                A script defines one global <code>plugin</code> with a <code>name</code>, an
                optional <code>icon</code> (<code>Icons.Box</code>, any lucide icon,
                autocompletes after the dot) and a list of <code>ui</code> controls.
            </p>
            <h4>Controls</h4>
            <pre>{`{ id = "dy", type = "number",
  label = "Lift", default = 5 },
{ id = "flip", type = "checkbox",
  label = "Flip", default = false },
{ id = "go", type = "button",
  label = "Place" },
{ id = "pic", type = "image",
  label = "Image" },`}</pre>
            <p>
                Values are read back by <code>id</code>: a control with <code>id = "dy"</code>
                arrives as <code>values.dy</code>.
            </p>
            <h4>Functions</h4>
            <p>
                <code>plugin.preview(part, values)</code> runs whenever a part is selected or a
                value changes. Return a part to show it as a ghost, or nothing for no preview.
            </p>
            <p>
                <code>plugin.click(id, part, values)</code> runs when a button is pressed, with
                the button's <code>id</code>. Return a part, or a list of parts. A list arrives
                selected and grouped in the Explorer.
            </p>
            <h4>Images</h4>
            <p>
                An <code>image</code> control has no <code>values</code> entry. The picked file
                arrives as the global <code>Image</code>, <code>nil</code> when none is picked:
            </p>
            <pre>{`Image.w, Image.h  -- pixels
local hex, a =
  Image.pixel(x, y)  -- 0-based`}</pre>
            <p>
                <code>hex</code> goes straight into <code>part.C</code>, <code>a</code> is alpha
                0-255. The grid is capped at 128 on its longest side; sample it down for coarser
                output.
            </p>
            <h4>A part</h4>
            <pre>{`part.P  -- position {x, y, z}
part.S  -- size {x, y, z}
part.R  -- rotation, degrees
part.C  -- hex color, no "#"
part.T  -- "Part", "SpawnLocation"
part.Tr -- transparency 0..1`}</pre>
            <p>
                Tables are 1-based, so the Y of a position is <code>part.P[2]</code>. Never edit
                <code>part</code> directly. Copy it, change the copy, return that.
            </p>
            <h4>Notes</h4>
            <ul>
                <li>Full Lua 5.4 standard library: <code>math</code>, <code>table</code>, <code>string</code>.</li>
                <li>Rotations are degrees; use <code>math.rad</code> before trig.</li>
                <li><b>Ctrl+S</b> or Save &amp; load compiles the script; errors show above with a line number.</li>
                <li>Each stamp is one undo step, so <b>Ctrl+Z</b> rewinds it.</li>
            </ul>
        </div>
    );
}
