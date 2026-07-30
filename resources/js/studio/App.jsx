import React, { useCallback, useEffect, useRef, useState } from 'react';
import Toolbar from './Toolbar';
import StartScreen from './StartScreen';
import Explorer from './Explorer';
import Properties from './Properties';
import Viewport from './Viewport';
import { loadMap, saveMap } from './api';

let nextId = 1;
const withId = (part) => ({ ...part, _id: nextId++ });

const NEW_PART = {
    Tr: 0, P: [0, 4, 0], S: [4, 2, 4], R: [0, 0, 0],
    T: 'Part', Shape: 'Block', C: 'a3a2a5',
};

const NEW_SPAWN = {
    Tr: 0, P: [0, 2.5, 0], S: [6, 1, 6], R: [0, 0, 0],
    T: 'SpawnLocation', Shape: 'Block', C: '4db84b',
};

export default function App() {
    const [mapName, setMapName] = useState(null);
    const [parts, setParts] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [tool, setTool] = useState('select');
    const [snap, setSnap] = useState({ moveOn: true, move: 1, rotateOn: true, rotate: 15 });
    const [studs, setStuds] = useState(() => localStorage.getItem('studio_studs') !== '0');
    const [status, setStatus] = useState('');
    const clipboard = useRef(null);
    const dirty = useRef(false);
    const history = useRef([]);
    const partsRef = useRef(parts);
    partsRef.current = parts;

    const selected = parts.find((p) => p._id === selectedId) ?? null;

    const toggleStuds = () => {
        setStuds((s) => {
            localStorage.setItem('studio_studs', s ? '0' : '1');
            return !s;
        });
    };

    const flash = (msg) => {
        setStatus(msg);
        setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2500);
    };

    const mutate = (fn) => {
        history.current.push(partsRef.current);
        if (history.current.length > 100) history.current.shift();
        dirty.current = true;
        setParts(fn);
    };

    const undo = useCallback(() => {
        const prev = history.current.pop();
        if (!prev) return;
        dirty.current = true;
        setParts(prev);
    }, []);

    const open = async (name) => {
        try {
            const data = await loadMap(name);
            setParts(data.map(withId));
            setMapName(name);
            setSelectedId(null);
            history.current = [];
            dirty.current = false;
        } catch (e) {
            flash(String(e.message ?? e));
        }
    };

    const openUploaded = (name, data) => {
        setParts(data.map(withId));
        setMapName(name);
        setSelectedId(null);
        history.current = [];
        dirty.current = true;
        flash(`Loaded upload as ${name}.json, Save to keep it`);
    };

    const download = () => {
        if (!mapName) return;
        const clean = parts.map(({ _id, ...rest }) => rest);
        const blob = new Blob([JSON.stringify(clean)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${mapName}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const createNew = (name) => {
        setParts([
            withId({ Tr: 0, P: [0, 0, 0], S: [200, 2, 200], R: [0, 0, 0], T: 'Part', Shape: 'Block', C: '7d7d85' }),
            withId(NEW_SPAWN),
        ]);
        setMapName(name);
        setSelectedId(null);
        history.current = [];
        dirty.current = true;
    };

    const save = useCallback(async (auto) => {
        if (!mapName) return;
        const snapshot = partsRef.current;
        try {
            const clean = snapshot.map(({ _id, ...rest }) => rest);
            await saveMap(mapName, clean);
            // Edits made while the request was in flight must stay dirty.
            if (partsRef.current === snapshot) dirty.current = false;
            flash(auto === true ? 'Auto-saved' : `Saved ${mapName}.json`);
        } catch (e) {
            flash(String(e.message ?? e));
        }
    }, [mapName]);

    // Auto-save: every 20 s, but only when there are unsaved changes.
    useEffect(() => {
        if (!mapName) return;
        const t = setInterval(() => {
            if (dirty.current) save(true);
        }, 20_000);
        return () => clearInterval(t);
    }, [mapName, save]);

    const updateSelected = (patch) => {
        if (selectedId == null) return;
        mutate((ps) => ps.map((p) => (p._id === selectedId ? { ...p, ...patch } : p)));
    };

    const addPart = (template) => {
        const part = withId({ ...template, P: [...template.P], S: [...template.S], R: [...template.R] });
        mutate((ps) => [...ps, part]);
        setSelectedId(part._id);
    };

    const copy = () => {
        if (selected) {
            const { _id, ...rest } = selected;
            clipboard.current = JSON.parse(JSON.stringify(rest));
        }
    };

    const paste = () => {
        if (!clipboard.current) return;
        const part = withId(JSON.parse(JSON.stringify(clipboard.current)));
        part.P = [part.P[0] + 2, part.P[1], part.P[2] + 2];
        mutate((ps) => [...ps, part]);
        setSelectedId(part._id);
    };

    const duplicate = () => {
        if (!selected) return;
        const { _id, ...rest } = selected;
        const part = withId(JSON.parse(JSON.stringify(rest)));
        mutate((ps) => [...ps, part]);
        setSelectedId(part._id);
    };

    const removeSelected = useCallback(() => {
        if (selectedId == null) return;
        mutate((ps) => ps.filter((p) => p._id !== selectedId));
        setSelectedId(null);
    }, [selectedId]);

    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (dirty.current) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
            if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
            if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
            else if (e.ctrlKey && e.key.toLowerCase() === 'c') copy();
            else if (e.ctrlKey && e.key.toLowerCase() === 'v') paste();
            else if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
            else if (e.key === '1') setTool('select');
            else if (e.key === '2') setTool('move');
            else if (e.key === '3') setTool('rotate');
            else if (e.key === '4') setTool('scale');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [save, removeSelected, undo, selected]);

    return (
        <div className="studio">
            <Toolbar
                tool={tool} setTool={setTool}
                snap={snap} setSnap={setSnap}
                hasSelection={!!selected} hasClipboard={!!clipboard.current}
                onAddPart={() => addPart(NEW_PART)}
                onAddSpawn={() => addPart(NEW_SPAWN)}
                onCopy={copy} onPaste={paste} onDuplicate={duplicate}
                onSave={save} onDownload={download} canSave={!!mapName}
                studs={studs} onToggleStuds={toggleStuds}
            />
            <div className="main">
                <div className="viewport-wrap">
                    <Viewport
                        parts={parts}
                        selectedId={selectedId}
                        setSelectedId={setSelectedId}
                        tool={tool}
                        snap={snap}
                        onTransform={updateSelected}
                        mapName={mapName}
                        studs={studs}
                    />
                    {mapName && (
                        <a className="credit" href="https://github.com/N7z/vortex-studio" target="_blank" rel="noreferrer">
                            Developed by zPaulinBRz
                        </a>
                    )}
                    {!mapName && <StartScreen onOpen={open} onCreate={createNew} onUpload={openUploaded} />}
                    {status && <div className="statusbar">{status}</div>}
                </div>
                <div className="sidebar">
                    <Explorer
                        parts={parts}
                        selectedId={selectedId}
                        setSelectedId={setSelectedId}
                        mapName={mapName}
                    />
                    <Properties part={selected} onChange={updateSelected} />
                </div>
            </div>
        </div>
    );
}
