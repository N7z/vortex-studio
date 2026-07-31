import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MenuBar from './MenuBar';
import Toolbar from './Toolbar';
import MobileBar from './MobileBar';
import TouchControls from './play/TouchControls';
import useIsMobile from './useIsMobile';
import StartScreen from './StartScreen';
import Explorer from './Explorer';
import Properties from './Properties';
import Viewport from './Viewport';
import PluginPanel from './PluginPanel';
import TabBar from './TabBar';
import StatsPanel from './StatsPanel';
import TeamPanel from './TeamPanel';
import ScriptTab, { TEMPLATE } from './ScriptTab';
import {
    loadPlugins, stripId, compilePlugin, saveUserPlugin, deleteUserPlugin,
    userPluginSource, isBuiltin, resetBuiltin,
} from './plugins';
import { loadMap, saveMap } from './api';
import { writeBackup } from './backup';
import {
    addOp, applyOp, fillPart, invertOp, patchOp, removeOp, repairParts, stripIds,
    transformOp, withNewId,
} from './ops';
import { DeleteIcon, DuplicateIcon } from './icons';
import { loadGraphics, saveGraphics } from './graphics';
import { roomFromUrl } from './live';
import useLive from './useLive';
import { decodeImage, imageMeta } from './image';
import { buildVoxels, loadModel } from './model';
import { convertRoblox, importSummary } from './roblox';
import {
    addGroup, forgetGroups, loadGroups, newGroup, pruneGroups, removeGroups, saveGroups, ungroupIds,
} from './groups';

const HISTORY_LIMIT = 100;

const NEW_PART = {
    Tr: 0, P: [0, 4, 0], S: [4, 2, 4], R: [0, 0, 0],
    T: 'Part', Shape: 'Block', C: 'a3a2a5',
};

const NEW_SPAWN = {
    Tr: 0, P: [0, 2.5, 0], S: [6, 1, 6], R: [0, 0, 0],
    T: 'SpawnLocation', Shape: 'Block', C: '4db84b',
};

const groupKey = (gs) => JSON.stringify(gs.map((g) => [g.id, g.name, g.ids]));

const MAX_PLUGIN_PARTS = 20000;

const MAX_MAP_PARTS = 20000;

const MAX_SELECTION_PARTS = 256;

export default function App() {
    const [mapName, setMapName] = useState(null);
    const [parts, setParts] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [faces, setFaces] = useState({});
    const [tool, setTool] = useState('select');
    const [snap, setSnap] = useState({ moveOn: true, move: 1, rotateOn: true, rotate: 15 });
    const [graphics, setGraphics] = useState(loadGraphics);
    const [plugins, setPlugins] = useState([]);
    const [activePluginId, setActivePluginId] = useState(null);
    const [pluginValues, setPluginValues] = useState({});
    const [pluginPreview, setPluginPreview] = useState([]);
    const [pluginImages, setPluginImages] = useState({});
    const [pluginModels, setPluginModels] = useState({});
    const loadedModels = useRef({});
    const [groups, setGroups] = useState([]);
    const [tabs, setTabs] = useState([]);
    const [activeTab, setActiveTab] = useState('home');
    const mobile = useIsMobile();
    const [drawer, setDrawer] = useState(false);
    const [drawerTab, setDrawerTab] = useState('explorer');
    const touchRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [teamOpen, setTeamOpen] = useState(false);
    const [statsOpen, setStatsOpen] = useState(false);
    const statsRef = useRef(null);
    const [joining, setJoining] = useState(() => roomFromUrl());
    const tabSeq = useRef(0);
    const previewSeq = useRef(0);
    const [status, setStatus] = useState('');
    const clipboard = useRef(null);
    const spawnRef = useRef(null);
    const busyRef = useRef(false);
    const dirty = useRef(false);
    const history = useRef([]);
    const future = useRef([]);
    const partsRef = useRef(parts);
    partsRef.current = parts;
    const syncedGroups = useRef(null);

    const flash = useCallback((msg) => {
        setStatus(msg);
        setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2500);
    }, []);

    const resetDocument = (name, raw, isDirty, remoteGroups) => {
        const { parts: data, fixed } = repairParts(raw);
        if (fixed) flash(`Repaired ${fixed} part${fixed === 1 ? '' : 's'} the server would reject`);
        setParts(data);
        setMapName(name);
        setActiveTab(name ? 'game' : 'home');
        setSelectedIds([]);
        setFaces({});
        const next = remoteGroups ?? loadGroups(name, data);
        syncedGroups.current = groupKey(next);
        setGroups(next);
        history.current = [];
        future.current = [];
        dirty.current = isDirty || fixed > 0;
    };

    const live = useLive({
        onWelcome: (msg) => {
            setJoining(null);
            if (msg.resumed) {
                const alive = new Set(msg.parts.map((p) => p._id));
                setParts(msg.parts);
                syncedGroups.current = groupKey(msg.groups ?? []);
                setGroups(msg.groups ?? []);
                setSelectedIds((cur) => cur.filter((id) => alive.has(id)));
            } else {
                setTeamOpen(true);
                resetDocument(msg.mapName, msg.parts, false, msg.groups ?? []);
            }
            flash(msg.resumed
                ? `Back in session ${msg.code}`
                : `Live session ${msg.code} as ${msg.you.name}`);
        },
        // Own ops are applied again when they echo back, not skipped: the room's order
        // is the authoritative one, and re-running an op that was already applied
        // optimistically is what makes two people editing the same part agree on who won.
        onOp: (msg) => {
            setParts((ps) => applyOp(ps, msg.op));
            // Only the owner has anything to persist, so only the owner's copy goes
            // dirty. Marking a spectator's would warn them about losing work on close.
            if (liveRef.current?.isOwner) dirty.current = true;
        },
        onSnapshot: (msg) => {
            setParts(msg.parts);
            if (msg.groups) {
                syncedGroups.current = groupKey(msg.groups);
                setGroups(msg.groups);
            }
            history.current = [];
            future.current = [];
        },
        onGroups: (msg) => {
            syncedGroups.current = groupKey(msg.groups);
            setGroups(msg.groups);
        },
        onError: (message) => {
            setJoining(null);
            flash(message);
        },
        onNotice: (message) => {
            flash(message);
            setTeamOpen(false);
            resetDocument(null, [], false);
        },
    });

    const liveRef = useRef(live);
    liveRef.current = live;
    const canEdit = (!live.live || live.canEdit) && !playing;
    const canEditRef = useRef(canEdit);
    canEditRef.current = canEdit;

    // The last id added is the "primary" selection: what Properties and plugins act on.
    const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selected = parts.find((p) => p._id === selectedId) ?? null;
    const selectedParts = useMemo(() => (
        selectedIds.length > 1
            ? parts.filter((p) => selectedSet.has(p._id))
            : (selected ? [selected] : [])
    ), [parts, selectedSet, selected]);
    const pluginTarget = selected;
    // Plugins are called one part at a time, so the bounds of a whole folder are
    // something only the app can work out. Handed over before every run.
    const selectionInfo = useMemo(() => {
        if (!selectedParts.length) return null;
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const p of selectedParts) {
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p.P[i] - p.S[i] / 2);
                max[i] = Math.max(max[i], p.P[i] + p.S[i] / 2);
            }
        }
        return {
            count: selectedParts.length,
            min,
            max,
            center: [0, 1, 2].map((i) => Math.round((min[i] + max[i]) / 2 * 1000) / 1000),
            parts: selectedParts.length <= MAX_SELECTION_PARTS
                ? selectedParts.map((p) => {
                    const bare = stripId(p);
                    return faces[p._id] ? { ...bare, F: faces[p._id] } : bare;
                })
                : null,
        };
    }, [selectedParts, faces]);
    const activePlugin = plugins.find((p) => p.id === activePluginId) ?? null;
    const activeValues = activePlugin ? pluginValues[activePlugin.id] ?? activePlugin.defaults : null;
    const activeImages = activePlugin ? pluginImages[activePlugin.id] ?? null : null;
    const activeModels = activePlugin ? pluginModels[activePlugin.id] ?? null : null;

    const select = useCallback((id, additive, normal) => {
        setSelectedIds((cur) => {
            if (id == null) return additive ? cur : [];
            if (!additive) return [id];
            return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        });
        setFaces((cur) => {
            if (id == null) return additive ? cur : {};
            const next = additive ? { ...cur } : {};
            if (normal) next[id] = normal;
            else delete next[id];
            return next;
        });
    }, []);
    const setSelectedId = select;

    const selectMany = useCallback((ids, additive) => {
        setSelectedIds((cur) => {
            if (!additive) return [...ids];
            const seen = new Set(cur);
            return [...cur, ...ids.filter((id) => !seen.has(id))];
        });
        if (!additive) setFaces({});
    }, []);

    const edit = useCallback((op) => {
        if (!canEditRef.current) {
            flash('You are a spectator in this session');
            return;
        }
        const before = partsRef.current;
        const next = applyOp(before, op);
        if (next === before) return;

        const inverse = invertOp(before, op);
        if (inverse) {
            history.current.push(inverse);
            if (history.current.length > HISTORY_LIMIT) history.current.shift();
            future.current = [];
        }
        dirty.current = true;
        setParts(next);
        liveRef.current.sendOp(op);
    }, [flash]);

    const step = useCallback((from, to) => {
        const op = from.current.pop();
        if (!op) return;
        const before = partsRef.current;
        const next = applyOp(before, op);
        if (next === before) return;

        const inverse = invertOp(before, op);
        if (inverse) {
            to.current.push(inverse);
            if (to.current.length > HISTORY_LIMIT) to.current.shift();
        }
        dirty.current = true;
        setParts(next);
        liveRef.current.sendOp(op);
    }, []);

    const undo = useCallback(() => {
        if (!canEditRef.current) return;
        step(history, future);
    }, [step]);

    const redo = useCallback(() => {
        if (!canEditRef.current) return;
        step(future, history);
    }, [step]);

    useEffect(() => {
        loadPlugins().then(setPlugins);
    }, []);

    useEffect(() => {
        if (joining) live.join(joining);
    }, []);

    useEffect(() => {
        const seq = ++previewSeq.current;
        if (!activePlugin || !pluginTarget) {
            setPluginPreview([]);
            return;
        }
        activePlugin.setSelection(selectionInfo)
            .then(() => activePlugin.preview(stripId(pluginTarget), activeValues))
            .then((made) => {
                if (previewSeq.current === seq) setPluginPreview(made.map((m) => m.part));
            })
            .catch(() => { if (previewSeq.current === seq) setPluginPreview([]); });
    }, [activePlugin, pluginTarget, activeValues, activeImages, selectionInfo]);

    useEffect(() => {
        if (live.live && live.canEdit) live.sendSelection(selectedIds);
    }, [selectedIds, live.live, live.canEdit, live.sendSelection]);

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
            for (const meta of Object.values(pluginImages[pid] ?? {})) {
                await compiled.setImage(meta);
            }
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
        if (id === 'game') {
            closeMap();
            return;
        }
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

    const pickImage = async (ctrlId, file) => {
        if (!activePlugin) return;
        const pluginId = activePlugin.id;
        try {
            const img = await decodeImage(file);
            await activePlugin.setImage(img);
            setPluginImages((all) => ({
                ...all,
                [pluginId]: { ...(all[pluginId] ?? {}), [ctrlId]: imageMeta(img) },
            }));
        } catch (e) {
            flash(`Could not read ${file.name}: ${e.message ?? e}`);
        }
    };

    const voxelise = async (plugin, ctrlId, entry, values) => {
        const control = plugin.ui.find((c) => c.id === ctrlId);
        const res = Number(values?.[control?.res]) || 32;
        const solid = !!values?.[control?.solid];
        const grid = await buildVoxels(entry.object, res, solid);
        await plugin.setModel(grid);
        setPluginModels((all) => ({
            ...all,
            [plugin.id]: {
                ...(all[plugin.id] ?? {}),
                [ctrlId]: { name: entry.name, ...grid, data: undefined },
            },
        }));
    };

    const pickModel = async (ctrlId, file) => {
        if (!activePlugin) return;
        const plugin = activePlugin;
        try {
            flash(`Reading ${file.name}...`);
            const object = await loadModel(file);
            const entry = { object, name: file.name };
            loadedModels.current[`${plugin.id}:${ctrlId}`] = entry;
            await voxelise(plugin, ctrlId, entry, activeValues);
            flash(`${file.name} ready`);
        } catch (e) {
            flash(`Could not read ${file.name}: ${e.message ?? e}`);
        }
    };

    useEffect(() => {
        if (!activePlugin) return;
        for (const c of activePlugin.ui) {
            if (c.type !== 'model') continue;
            const entry = loadedModels.current[`${activePlugin.id}:${c.id}`];
            if (!entry) continue;
            voxelise(activePlugin, c.id, entry, activeValues).catch((e) => {
                flash(`Could not voxelise: ${e.message ?? e}`);
            });
        }
    }, [activePlugin, activeValues]);

    const pluginButton = async (btnId) => {
        if (!activePlugin || !selectedParts.length) return;
        try {
            const parts = [];
            const updates = [];
            let capped = false;
            await activePlugin.setSelection(selectionInfo);
            for (const target of selectedParts) {
                const made = await activePlugin.click(btnId, stripId(target), activeValues);
                // Only the first Replace can land on the source; the rest have no
                // part of their own to update, so they are added like anything else.
                let taken = false;
                for (const { part, replace } of made) {
                    if (replace && !taken) {
                        taken = true;
                        updates.push({ id: target._id, ...fillPart(part, target) });
                        continue;
                    }
                    if (parts.length >= MAX_PLUGIN_PARTS
                        || partsRef.current.length + parts.length >= MAX_MAP_PARTS) {
                        capped = true;
                        break;
                    }
                    parts.push(fillPart(part, target));
                }
                if (capped) break;
            }
            if (capped) flash(`Stopped at ${MAX_MAP_PARTS} parts, the most a map can hold`);
            if (updates.length) {
                edit(transformOp(updates));
                if (!parts.length) {
                    flash(`${activePlugin.name} moved ${updates.length} parts`);
                    return;
                }
            }
            if (!parts.length) return;
            const placed = parts.map(withNewId);
            edit(addOp(placed));
            setSelectedIds(placed.map((p) => p._id));
            if (placed.length > 1) {
                const label = pluginImages[activePlugin.id]?.img?.name;
                setGroups((gs) => addGroup(
                    gs,
                    label ? `${activePlugin.name}: ${label}` : activePlugin.name,
                    placed.map((p) => p._id),
                ));
                flash(`${activePlugin.name} placed ${placed.length} parts, grouped in the explorer`);
            }
        } catch (e) {
            flash(String(e.message ?? e));
        }
    };

    const groupSelection = useCallback(() => {
        if (selectedIds.length < 2) return;
        setGroups((gs) => addGroup(gs, `Group ${gs.length + 1}`, selectedIds));
        flash(`Grouped ${selectedIds.length} parts`);
    }, [selectedIds, flash]);

    const ungroupSelection = useCallback(() => {
        if (!selectedIds.length) return;
        setGroups((gs) => {
            const next = ungroupIds(gs, selectedIds);
            if (next.length !== gs.length) flash('Ungrouped');
            return next;
        });
    }, [selectedIds, flash]);

    const ungroup = (groupId) => setGroups((gs) => removeGroups(gs, [groupId]));

    const renameGroup = (groupId, name) => {
        setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, name } : g)));
    };

    useEffect(() => {
        setGroups((gs) => pruneGroups(gs, parts));
    }, [parts]);

    useEffect(() => {
        if (mapName) saveGroups(mapName, groups, parts);
    }, [mapName, groups, parts]);

    useEffect(() => {
        if (!live.live || !live.canEdit) return;
        const key = groupKey(groups);
        if (key === syncedGroups.current) return;
        syncedGroups.current = key;
        live.sendGroups(groups);
    }, [groups, live.live, live.canEdit, live.sendGroups]);

    const changeGraphics = (patch) => {
        setGraphics((g) => {
            const next = { ...g, ...patch };
            saveGraphics(next);
            return next;
        });
    };

    const open = async (name) => {
        // Reloading the open map would throw away unsaved edits, so just show it.
        if (name === mapName) {
            setActiveTab('game');
            return;
        }
        try {
            const data = await loadMap(name);
            resetDocument(name, data.map(withNewId), false);
        } catch (e) {
            flash(String(e.message ?? e));
        }
    };

    // A local backup goes straight back into the editor, dirty, so the next save
    // (manual or auto) puts it on the server again.
    const restore = (name, data) => {
        resetDocument(name, data.map(withNewId), true);
        flash(`Restored ${name}.json from this device`);
    };

    const openUploaded = (name, data) => {
        resetDocument(name, data.map(withNewId), true);
        flash(`Loaded upload as ${name}.json, Save to keep it`);
    };

    const mapNameFrom = (fileName) => (fileName ?? '')
        .replace(/\.json$/i, '')
        .replace(/[^A-Za-z0-9_-]/g, '-')
        .slice(0, 64) || 'roblox';

    const importRobloxText = (text, fileName) => {
        let result;
        try {
            result = convertRoblox(JSON.parse(text), MAX_MAP_PARTS - (mapName ? partsRef.current.length : 0));
        } catch (e) {
            flash(`Could not import: ${e.message ?? e}`);
            return;
        }
        if (!result.parts.length) {
            flash(result.dropped
                ? `Nothing imported, ${result.dropped} part${result.dropped === 1 ? '' : 's'} had no usable Position or Size`
                : 'Nothing imported, that file has no parts');
            return;
        }
        if (mapName) {
            if (!canEditRef.current) {
                flash('You are a spectator in this session');
                return;
            }
            const added = addMany(result.parts);
            setGroups((gs) => addGroup(gs, `Roblox import${fileName ? `: ${fileName}` : ''}`, added.map((p) => p._id)));
        } else {
            resetDocument(mapNameFrom(fileName), result.parts.map(withNewId), true);
        }
        flash(importSummary(result));
    };

    const importRoblox = async (file) => {
        try {
            importRobloxText(await file.text(), file.name);
        } catch (e) {
            flash(`Could not read ${file.name}: ${e.message ?? e}`);
        }
    };

    const pasteRoblox = () => {
        const text = prompt('Paste the exported Roblox JSON:');
        if (text) importRobloxText(text, null);
    };

    const download = () => {
        if (!mapName) return;
        const blob = new Blob([JSON.stringify(stripIds(parts))], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${mapName}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const createNew = (name) => {
        forgetGroups(name);
        resetDocument(name, [
            withNewId({ Tr: 0, P: [0, 0, 0], S: [200, 2, 200], R: [0, 0, 0], T: 'Part', Shape: 'Block', C: '7d7d85' }),
            withNewId(NEW_SPAWN),
        ], true);
    };

    const canSaveToServer = !!mapName && (!live.live || live.isOwner);

    const save = useCallback(async (auto) => {
        if (!mapName) return;
        if (liveRef.current.live && !liveRef.current.isOwner) {
            if (auto !== true) flash('The session owner saves this map');
            return;
        }
        const snapshot = partsRef.current;
        const clean = stripIds(snapshot);
        // Mirror locally first: the copy that matters most is the one for a save that
        // is about to fail. A save also restarts the server-side 24h TTL for this map.
        const backed = writeBackup(mapName, clean);
        try {
            await saveMap(mapName, clean);
            // Edits made while the request was in flight must stay dirty.
            if (partsRef.current === snapshot) dirty.current = false;
            liveRef.current.notifySaved();
            flash(auto === true ? 'Auto-saved' : `Saved ${mapName}.json`);
        } catch (e) {
            flash(backed
                ? `Server save failed (${e.message ?? e}), kept a copy on this device`
                : String(e.message ?? e));
        }
    }, [mapName, flash]);

    // Auto-save: every 20 s, but only when there are unsaved changes.
    useEffect(() => {
        if (!mapName) return;
        const t = setInterval(() => {
            if (dirty.current) save(true);
        }, 20_000);
        return () => clearInterval(t);
    }, [mapName, save]);

    const goLive = () => {
        if (!mapName) return;
        live.host(mapName, partsRef.current, groups);
        setTeamOpen(true);
    };

    const leaveSession = () => {
        const wasOwner = live.isOwner;
        live.leave();
        setTeamOpen(false);
        if (wasOwner) {
            dirty.current = true;
            flash('Left the live session, this map is yours again');

            return;
        }
        resetDocument(null, [], false);
        flash('Left the live session');
    };

    const closeMap = () => {
        if (dirty.current && !confirm(`${mapName}.json has unsaved changes. Close it anyway?`)) return;
        if (liveRef.current?.live) live.leave();
        setTeamOpen(false);
        setPlaying(false);
        setActivePluginId(null);
        resetDocument(null, [], false);
    };

    // A property edit applies to every selected part, not just the primary one.
    const updateSelected = (patch) => {
        if (!selectedIds.length) return;
        edit(patchOp(selectedIds, patch));
    };

    // The gizmo moved several parts at once: each one gets its own transform.
    const transformMany = (updates) => {
        edit(transformOp(updates));
    };

    const addPart = (template) => {
        const P = spawnRef.current?.(template.S[1]) ?? [...template.P];
        const part = withNewId({ ...template, P, S: [...template.S], R: [...template.R] });
        edit(addOp([part]));
        setSelectedId(part._id);
    };

    const copy = () => {
        if (!selectedParts.length) return;
        const slot = new Map(selectedParts.map((p, i) => [p._id, i]));
        clipboard.current = {
            parts: stripIds(selectedParts).map((p) => JSON.parse(JSON.stringify(p))),
            groups: groups
                .filter((g) => g.ids.every((id) => slot.has(id)))
                .map((g) => ({ name: g.name, slots: g.ids.map((id) => slot.get(id)) })),
        };
    };

    const addMany = (templates) => {
        const added = templates.map((t) => withNewId(JSON.parse(JSON.stringify(t))));
        edit(addOp(added));
        setSelectedIds(added.map((p) => p._id));
        return added;
    };

    const paste = () => {
        const clip = clipboard.current;
        if (!clip?.parts.length) return;
        const added = addMany(clip.parts.map((p) => ({ ...p, P: [p.P[0] + 2, p.P[1], p.P[2] + 2] })));
        if (!clip.groups.length) return;
        setGroups((gs) => [
            ...gs,
            ...clip.groups.map((g) => newGroup(g.name, g.slots.map((i) => added[i]._id))),
        ]);
    };

    const duplicate = () => {
        if (!selectedParts.length) return;
        const added = addMany(stripIds(selectedParts));
        const fresh = new Map(selectedParts.map((p, i) => [p._id, added[i]._id]));
        setGroups((gs) => {
            const copies = gs
                .filter((g) => g.ids.every((id) => fresh.has(id)))
                .map((g) => newGroup(`${g.name} copy`, g.ids.map((id) => fresh.get(id))));
            return copies.length ? [...gs, ...copies] : gs;
        });
    };

    const removeSelected = useCallback(() => {
        if (!selectedIds.length) return;
        edit(removeOp(selectedIds));
        setSelectedIds([]);
    }, [selectedIds, edit]);

    useEffect(() => {
        if (mobile && selected) setDrawerTab('properties');
    }, [mobile, selected?._id]);

    useEffect(() => {
        if (mobile && tabs.some((t) => t.id === activeTab)) setActiveTab(mapName ? 'game' : 'home');
    }, [mobile, activeTab, tabs, mapName]);

    useEffect(() => {
        if (!live.live || playing) return undefined;
        live.sendPlay(null);

        return undefined;
    }, [playing, live.live]);

    const knownTesters = useRef([]);
    useEffect(() => {
        const now = live.playingIds ?? [];
        const started = now.filter((id) => !knownTesters.current.includes(id));
        knownTesters.current = now;
        if (!started.length || playing) return;
        const names = started
            .map((id) => live.members.find((m) => m.id === id)?.name)
            .filter(Boolean);
        if (names.length) flash(`${names.join(', ')} started a play test`);
    }, [live.playingIds]);

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
            const scriptTab = tabs.find((t) => t.id === activeTab);
            if (e.ctrlKey && e.key.toLowerCase() === 's' && scriptTab) {
                e.preventDefault();
                saveTab(scriptTab);
                return;
            }
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
            if (e.key === 'F6' && mapName) {
                e.preventDefault();
                setSelectedIds([]);
                setPlaying((p) => !p);
                return;
            }
            if (playing) return;
            if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
            if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
            if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
            if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
            else if (e.ctrlKey && e.key.toLowerCase() === 'c') copy();
            else if (e.ctrlKey && e.key.toLowerCase() === 'v') paste();
            else if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
            else if (e.ctrlKey && e.key.toLowerCase() === 'g') {
                e.preventDefault();
                if (e.shiftKey) ungroupSelection();
                else groupSelection();
            }
            else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                setSelectedIds(partsRef.current.map((p) => p._id));
            }
            else if (e.key === '1') setTool('select');
            else if (e.key === '2') setTool('move');
            else if (e.key === '3') setTool('rotate');
            else if (e.key === '4') setTool('scale');
            else if (!e.ctrlKey && !e.altKey && !busyRef.current) {
                const k = e.key.toLowerCase();
                if (k === 'w') setTool('move');
                else if (k === 'e') setTool('rotate');
                else if (k === 'r') setTool('scale');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [save, removeSelected, undo, redo, selected, selectedIds, parts, activeTab, tabs,
        groupSelection, ungroupSelection, playing, mapName]);

    return (
        <div className={mobile ? 'studio mobile' : 'studio'}>
            <MenuBar
                mobile={mobile}
                hasMap={!!mapName} canEdit={canEdit}
                hasSelection={!!selected} hasClipboard={!!clipboard.current}
                onSave={save} canSave={canSaveToServer}
                onDownload={download} canDownload={!!mapName && canEdit}
                onImportRoblox={importRoblox} onPasteRoblox={pasteRoblox}
                canImport={!mapName || canEdit}
                onUndo={undo} onRedo={redo}
                onCopy={copy} onPaste={paste} onDuplicate={duplicate}
                onDelete={removeSelected}
                onSelectAll={() => setSelectedIds(partsRef.current.map((p) => p._id))}
                onGroup={groupSelection} onUngroup={ungroupSelection}
                onAddPart={() => addPart(NEW_PART)}
                onAddSpawn={() => addPart(NEW_SPAWN)}
                graphics={graphics} onGraphics={changeGraphics}
                teamOpen={teamOpen} onToggleTeam={() => setTeamOpen((o) => !o)}
                statsOpen={statsOpen} onToggleStats={() => setStatsOpen((o) => !o)}
                plugins={plugins} activePluginId={activePluginId}
                onTogglePlugin={togglePlugin} onNewPlugin={openNewPluginTab}
            />
            {mobile ? (
                <MobileBar
                    tool={tool} setTool={setTool}
                    hasSelection={!!selected} canEdit={canEdit}
                    onUndo={undo} onRedo={redo}
                    onAddPart={() => addPart(NEW_PART)}
                    onDelete={removeSelected}
                    onSave={save} canSave={canSaveToServer}
                    hasMap={!!mapName}
                    playing={playing}
                    onPlay={() => { setSelectedIds([]); setPlaying(true); }}
                    onStop={() => setPlaying(false)}
                />
            ) : (
            <Toolbar
                tool={tool} setTool={setTool}
                snap={snap} setSnap={setSnap}
                hasSelection={!!selected} hasClipboard={!!clipboard.current}
                canEdit={canEdit}
                onUndo={undo} onRedo={redo}
                onAddPart={() => addPart(NEW_PART)}
                onAddSpawn={() => addPart(NEW_SPAWN)}
                onCopy={copy} onPaste={paste} onDuplicate={duplicate}
                onDelete={removeSelected}
                onSave={save} canSave={canSaveToServer}
                graphics={graphics} onGraphics={changeGraphics}
                live={live} teamOpen={teamOpen}
                onToggleTeam={() => setTeamOpen((o) => !o)}
                hasMap={!!mapName}
                playing={playing}
                onPlay={() => { setSelectedIds([]); setPlaying(true); }}
                onStop={() => setPlaying(false)}
            />
            )}
            <TabBar
                tabs={[
                    { id: 'home', title: 'Welcome', icon: 'globe', closable: false },
                    ...(mapName ? [{ id: 'game', title: mapName, icon: 'globe', closable: true }] : []),
                    ...(mobile ? [] : tabs.map((t) => ({ id: t.id, title: t.title, icon: t.icon, closable: true }))),
                ]}
                active={activeTab}
                onSelect={setActiveTab}
                onClose={closeTab}
            />
            {!mobile && tabs.map((t) => (
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
            {activeTab === 'home' && (
                <div className="home-tab">
                    <StartScreen
                        onOpen={open} onCreate={createNew}
                        onUpload={openUploaded} onRestore={restore}
                        onPasteRoblox={pasteRoblox}
                        openName={mapName}
                        mobile={mobile}
                        joining={joining} liveStatus={live.status}
                    />
                </div>
            )}
            <div className="main" style={activeTab === 'game' ? undefined : { display: 'none' }}>
                <div className="viewport-wrap">
                    <Viewport
                        parts={parts}
                        selectedIds={selectedIds}
                        setSelectedId={setSelectedId}
                        selectMany={selectMany}
                        faces={faces}
                        showFaces={!!activePlugin?.usesFaces}
                        statsRef={statsRef}
                        tool={tool}
                        snap={snap}
                        canEdit={canEdit}
                        peers={live.peers}
                        onView={live.live ? live.sendView : null}
                        onTransform={updateSelected}
                        onTransformMany={transformMany}
                        mapName={mapName}
                        graphics={graphics}
                        preview={pluginPreview}
                        spawnRef={spawnRef}
                        busyRef={busyRef}
                        playing={playing}
                        onExitPlay={() => setPlaying(false)}
                        touchRef={touchRef}
                        playRef={live.live ? live.playRef : null}
                        onPlayState={live.live ? live.sendPlay : null}
                    />
                    {mobile && playing && (
                        <TouchControls inputRef={touchRef} onExit={() => setPlaying(false)} />
                    )}
                    {activePlugin && mapName && !mobile && (
                        <PluginPanel
                            plugin={activePlugin}
                            values={activeValues}
                            setValue={setPluginValue}
                            images={activeImages}
                            onImage={pickImage}
                            models={activeModels}
                            onModel={pickModel}
                            hasSelection={selectedParts.length > 0}
                            targetNote={selectedParts.length > 1
                                ? `Runs on all ${selectedParts.length} selected parts`
                                : null}
                            onButton={pluginButton}
                            onEdit={() => openEditTab(activePlugin.id)}
                            onClose={() => setActivePluginId(null)}
                        />
                    )}
                    {teamOpen && mapName && (
                        <TeamPanel
                            live={live}
                            onGoLive={goLive}
                            onLeave={leaveSession}
                            playing={playing}
                            onPlay={() => { setSelectedIds([]); setPlaying(true); }}
                            onClose={() => setTeamOpen(false)}
                        />
                    )}
                    {statsOpen && (
                        <StatsPanel
                            parts={parts}
                            selectedIds={selectedIds}
                            groups={groups}
                            mapName={mapName}
                            statsRef={statsRef}
                            onClose={() => setStatsOpen(false)}
                        />
                    )}
                    {mobile && mapName && !playing && selectedIds.length > 0 && canEdit && (
                        <div className="touch-actions">
                            <button onClick={duplicate} title="Duplicate"><DuplicateIcon /></button>
                            <button onClick={removeSelected} title="Delete"><DeleteIcon /></button>
                            <button onClick={() => setSelectedIds([])} title="Deselect">×</button>
                        </div>
                    )}
                    {mapName && <span className="credit">Developed by zPaulinBRz</span>}
                    {status && <div className="statusbar">{status}</div>}
                </div>
                {mobile && (
                    <button
                        className={drawer ? 'drawer-handle open' : 'drawer-handle'}
                        onClick={() => setDrawer((o) => !o)}
                        title={drawer ? 'Hide panel' : 'Show panel'}
                    >
                        {drawer ? '›' : '‹'}
                    </button>
                )}
                <div className={`sidebar${mobile ? ' drawer' : ''}${mobile && drawer ? ' open' : ''}`}>
                    {mobile && (
                        <div className="drawer-tabs">
                            <button
                                className={drawerTab === 'explorer' ? 'on' : ''}
                                onClick={() => setDrawerTab('explorer')}
                            >
                                Explorer
                            </button>
                            <button
                                className={drawerTab === 'properties' ? 'on' : ''}
                                onClick={() => setDrawerTab('properties')}
                            >
                                Properties
                            </button>
                        </div>
                    )}
                    {(!mobile || drawerTab === 'explorer') && (
                        <Explorer
                            parts={parts}
                            selectedIds={selectedIds}
                            setSelectedId={setSelectedId}
                            selectMany={selectMany}
                            groups={groups}
                            onUngroup={ungroup}
                            onRenameGroup={renameGroup}
                            mapName={mapName}
                        />
                    )}
                    {(!mobile || drawerTab === 'properties') && (
                        <Properties
                            part={selected}
                            count={selectedIds.length}
                            onChange={updateSelected}
                            readOnly={!canEdit}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
