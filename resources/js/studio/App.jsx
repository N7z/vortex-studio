import React, { useCallback, useEffect, useRef, useState } from 'react';
import Toolbar from './Toolbar';
import StartScreen from './StartScreen';
import Explorer from './Explorer';
import Properties from './Properties';
import Viewport from './Viewport';
import PluginPanel from './PluginPanel';
import TabBar from './TabBar';
import ScriptTab, { TEMPLATE } from './ScriptTab';
import {
    loadPlugins, stripId, compilePlugin, saveUserPlugin, deleteUserPlugin,
    userPluginSource, isBuiltin, resetBuiltin,
} from './plugins';
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
    const [plugins, setPlugins] = useState([]);
    const [activePluginId, setActivePluginId] = useState(null);
    const [pluginValues, setPluginValues] = useState({});
    const [pluginPreview, setPluginPreview] = useState(null);
    const [tabs, setTabs] = useState([]);
    const [activeTab, setActiveTab] = useState('game');
    const tabSeq = useRef(0);
    const previewSeq = useRef(0);
    const [status, setStatus] = useState('');
    const clipboard = useRef(null);
    const dirty = useRef(false);
    const history = useRef([]);
    const partsRef = useRef(parts);
    partsRef.current = parts;

    const selected = parts.find((p) => p._id === selectedId) ?? null;
    const activePlugin = plugins.find((p) => p.id === activePluginId) ?? null;
    const activeValues = activePlugin ? pluginValues[activePlugin.id] ?? activePlugin.defaults : null;

    useEffect(() => {
        loadPlugins().then(setPlugins);
    }, []);

    useEffect(() => {
        const seq = ++previewSeq.current;
        if (!activePlugin || !selected) {
            setPluginPreview(null);
            return;
        }
        activePlugin.preview(stripId(selected), activeValues)
            .then((p) => { if (previewSeq.current === seq) setPluginPreview(p); })
            .catch(() => { if (previewSeq.current === seq) setPluginPreview(null); });
    }, [activePlugin, selected, activeValues]);

    const togglePlugin = (id) => {
        setActivePluginId((cur) => (cur === id ? null : id));
    };

    const setPluginValue = (id, v) => {
        if (!activePlugin) return;
        setPluginValues((all) => ({
            ...all,
            [activePlugin.id]: { ...(all[activePlugin.id] ?? activePlugin.defaults), [id]: v },
        }));
    };

    const savePlugin = async (id, src) => {
        const pid = id ?? `user-${Date.now()}`;
        const builtin = isBuiltin(pid);
        try {
            const compiled = await compilePlugin(pid, src, builtin);
            saveUserPlugin(pid, src);
            const old = plugins.find((p) => p.id === pid);
            old?.close?.();
            setPlugins((ps) => ps.some((p) => p.id === pid)
                ? ps.map((p) => (p.id === pid ? compiled : p))
                : [...ps, compiled]);
            flash(`Plugin ${compiled.name} loaded`);
            return { id: pid, name: compiled.name, icon: compiled.icon };
        } catch (e) {
            return { error: String(e.message ?? e) };
        }
    };

    const removePlugin = (id) => {
        deleteUserPlugin(id);
        plugins.find((p) => p.id === id)?.close?.();
        setPlugins((ps) => ps.filter((p) => p.id !== id));
        setActivePluginId((cur) => (cur === id ? null : cur));
    };

    const openNewPluginTab = () => {
        const id = `tab-${++tabSeq.current}`;
        setTabs((ts) => [...ts, { id, pluginId: null, title: 'New plugin', icon: 'script', src: TEMPLATE }]);
        setActiveTab(id);
    };

    const openEditTab = (pluginId) => {
        const existing = tabs.find((t) => t.pluginId === pluginId);
        if (existing) {
            setActiveTab(existing.id);
            return;
        }
        const plugin = plugins.find((p) => p.id === pluginId);
        const id = `tab-${++tabSeq.current}`;
        setTabs((ts) => [...ts, {
            id,
            pluginId,
            title: plugin?.name ?? 'Plugin',
            icon: plugin?.icon,
            builtin: isBuiltin(pluginId),
            src: userPluginSource(pluginId) ?? TEMPLATE,
        }]);
        setActiveTab(id);
    };

    const closeTab = (id) => {
        setTabs((ts) => ts.filter((t) => t.id !== id));
        setActiveTab((cur) => (cur === id ? 'game' : cur));
    };

    const updateTabSrc = (id, src) => {
        setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, src } : t)));
    };

    const saveTab = async (tab) => {
        const res = await savePlugin(tab.pluginId, tab.src);
        if (res.error) return res.error;
        setTabs((ts) => ts.map((t) => (
            t.id === tab.id ? { ...t, pluginId: res.id, title: res.name, icon: res.icon } : t
        )));
        return null;
    };

    const deleteTab = (tab) => {
        if (tab.pluginId) removePlugin(tab.pluginId);
        closeTab(tab.id);
    };

    const resetTab = async (tab) => {
        const src = resetBuiltin(tab.pluginId);
        updateTabSrc(tab.id, src);
        const res = await savePlugin(tab.pluginId, src);
        deleteUserPlugin(tab.pluginId);
        return res.error ?? null;
    };

    const pluginButton = async (btnId) => {
        if (!activePlugin || !selected) return;
        try {
            const part = await activePlugin.click(btnId, stripId(selected), activeValues);
            if (!part) return;
            const placed = withId(part);
            mutate((ps) => [...ps, placed]);
            setSelectedId(placed._id);
        } catch (e) {
            flash(String(e.message ?? e));
        }
    };

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
            if (e.ctrlKey && e.key.toLowerCase() === 's' && activeTab !== 'game') {
                e.preventDefault();
                const tab = tabs.find((t) => t.id === activeTab);
                if (tab) saveTab(tab);
                return;
            }
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
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
    }, [save, removeSelected, undo, selected, activeTab, tabs]);

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
                plugins={plugins} activePluginId={activePluginId} onTogglePlugin={togglePlugin}
                onNewPlugin={openNewPluginTab}
            />
            <TabBar
                tabs={[
                    { id: 'game', title: mapName ? 'Workspace' : 'Welcome', icon: 'globe', closable: false },
                    ...tabs.map((t) => ({ id: t.id, title: t.title, icon: t.icon, closable: true })),
                ]}
                active={activeTab}
                onSelect={setActiveTab}
                onClose={closeTab}
            />
            {tabs.map((t) => (
                <ScriptTab
                    key={t.id}
                    tab={t}
                    visible={activeTab === t.id}
                    onChange={(src) => updateTabSrc(t.id, src)}
                    onSave={() => saveTab(t)}
                    onDelete={() => deleteTab(t)}
                    onReset={() => resetTab(t)}
                />
            ))}
            <div className="main" style={activeTab === 'game' ? undefined : { display: 'none' }}>
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
                        preview={pluginPreview}
                    />
                    {activePlugin && mapName && (
                        <PluginPanel
                            plugin={activePlugin}
                            values={activeValues}
                            setValue={setPluginValue}
                            hasSelection={!!selected}
                            onButton={pluginButton}
                            onEdit={() => openEditTab(activePlugin.id)}
                            onClose={() => setActivePluginId(null)}
                        />
                    )}
                    {mapName && <span className="credit">Developed by zPaulinBRz</span>}
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
