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
    loadPlugins, setPartLimit, stripId, compilePlugin, saveUserPlugin, deleteUserPlugin,
    userPluginSource, isBuiltin, resetBuiltin,
} from './plugins';
import { listTeams, loadAccount, loadMap, loadMapAsAdmin, putThumb, saveMap } from './api';
import { writeBackup } from './backup';
import {
    addOp, applyOp, fillPart, invertOp, patchOp, removeOp, repairParts, stripIds,
    transformOp, withNewId,
} from './ops';
import { DeleteIcon, DuplicateIcon } from './icons';
import { loadGraphics, saveGraphics } from './graphics';
import { roomFromUrl } from './live';
import UpdateNotice from './UpdateNotice';
import { watchForUpdate } from './version';
import useLive from './useLive';
import { decodeImage, imageMeta } from './image';
import { MAX_RES, buildVoxels, loadModel } from './model';
import { convertRoblox, importSummary } from './roblox';
import useDialogs from '../ui/useDialogs';
import Busy from '../ui/Busy';
import {
    applyGroupOp, newGroupId, pruneGroups, takeLegacyGroups, ungroupIds,
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


const MAX_PLUGIN_PARTS = 60000;

const MAX_MAP_PARTS = 60000;

const MAX_SELECTION_PARTS = 256;

const GROUPS_DEBOUNCE_MS = 400;

// Heavy work in the same tick as setBusy paints nothing, so the spinner is given a
// frame of its own first.
const paint = () => new Promise((r) => requestAnimationFrame(() => r()));

// Autosave runs every 20s; a picture that often is wasted upload for a view that
// barely changed.
const THUMB_EVERY_MS = 120_000;

export default function App() {
    const [mapName, setMapName] = useState(null);
    const [mapTeam, setMapTeam] = useState(null);
    const [teams, setTeams] = useState([]);
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
    const [viewing] = useState(() => new URLSearchParams(window.location.search).get('view'));
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
    const groupsRef = useRef([]);
    groupsRef.current = groups;
    const loadedGroups = useRef(groups);
    const mapNameRef = useRef(null);
    const mapTeamRef = useRef(null);
    mapTeamRef.current = mapTeam;
    // The stored version this copy was built on; a save that does not match it is refused.
    const versionRef = useRef(null);
    const staleSeen = useRef(false);
    const thumbRef = useRef(null);
    const thumbAt = useRef(0);
    const { dialogs, confirm, ask } = useDialogs();
    const [busy, setBusy] = useState(null);
    // An admin is trusted with maps of any size, so nothing here caps them.
    const [unlimited, setUnlimited] = useState(false);
    const [account, setAccount] = useState(null);
    const [accountTtl, setAccountTtl] = useState(24);
    const [claimed, setClaimed] = useState(0);
    // Bumped when signing in or out, so the start screen refetches what is visible.
    const [accountSeq, setAccountSeq] = useState(0);
    const mapCap = unlimited ? Infinity : MAX_MAP_PARTS;
    const pluginCap = unlimited ? Infinity : MAX_PLUGIN_PARTS;
    const resCap = unlimited ? 512 : MAX_RES;

    // Only the id travels with a map, so the names are looked up once and again
    // whenever one turns up that this list does not know.
    useEffect(() => {
        if (mapTeam != null && teams.some((t) => t.id === mapTeam)) return;
        listTeams().then((d) => setTeams(d.teams ?? []));
    }, [mapTeam]);

    useEffect(() => {
        loadAccount()
            .then((d) => {
                setAccount(d.account ?? null);
                setUnlimited(!!d.account?.admin);
            })
            .catch(() => setUnlimited(false));
    }, []);

    const accountChanged = useCallback((next, moved) => {
        setAccount(next);
        setUnlimited(!!next?.admin);
        setClaimed(moved ?? 0);
        setAccountSeq((n) => n + 1);
    }, []);

    useEffect(() => {
        setPartLimit(unlimited ? Number.MAX_SAFE_INTEGER : MAX_PLUGIN_PARTS);
    }, [unlimited]);

    const flash = useCallback((msg) => {
        setStatus(msg);
        setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2500);
    }, []);

    const resetDocument = (name, raw, isDirty, remoteGroups, teamId = null, version = null) => {
        const { parts: data, fixed } = repairParts(raw);
        if (fixed) flash(`Repaired ${fixed} part${fixed === 1 ? '' : 's'} the server would reject`);
        setParts(data);
        setMapName(name);
        mapNameRef.current = name;
        setMapTeam(teamId);
        mapTeamRef.current = teamId;
        versionRef.current = version;
        staleSeen.current = false;
        setActiveTab(name ? 'game' : 'home');
        setSelectedIds([]);
        setFaces({});
        // Anything an older build left in localStorage is drained once, and only
        // when the map itself carries none, so an import cannot overwrite real data.
        const legacy = remoteGroups?.length ? [] : takeLegacyGroups(name, data);
        const next = legacy.length ? legacy : (remoteGroups ?? []);
        loadedGroups.current = next;
        setGroups(next);
        history.current = [];
        future.current = [];
        dirty.current = isDirty || fixed > 0 || legacy.length > 0;

        return { parts: data, groups: next };
    };

    const live = useLive({
        onWelcome: (msg) => {
            setJoining(null);
            if (msg.resumed) {
                const alive = new Set(msg.parts.map((p) => p._id));
                setParts(msg.parts);
                setGroups(msg.groups ?? []);
                setSelectedIds((cur) => cur.filter((id) => alive.has(id)));
            } else {
                // A team map is always in session, so the panel is not news.
                if (mapTeamRef.current == null) setTeamOpen(true);
                resetDocument(msg.mapName, msg.parts, false, msg.groups ?? [],
                    mapTeamRef.current, versionRef.current);
            }
            if (mapTeamRef.current != null) {
                flash(msg.resumed ? 'Back with the team' : `Editing with the team as ${msg.you.name}`);
            } else {
                flash(msg.resumed
                    ? `Back in session ${msg.code}`
                    : `Live session ${msg.code} as ${msg.you.name}`);
            }
        },
        // Own ops are applied again when they echo back, not skipped: the room's order
        // is the authoritative one, and re-running an op that was already applied
        // optimistically is what makes two people editing the same part agree on who won.
        onOp: (msg) => {
            setParts((ps) => applyOp(ps, msg.op));
            if (liveRef.current?.canEdit) dirty.current = true;
        },
        onSnapshot: (msg) => {
            setParts(msg.parts);
            if (msg.groups) {
                setGroups(msg.groups);
            }
            history.current = [];
            future.current = [];
        },
        onGroups: (msg) => {
            setGroups(msg.groups);
        },
        onGroupOp: (msg) => {
            setGroups((gs) => applyGroupOp(gs, msg.op));
            if (liveRef.current?.canEdit) dirty.current = true;
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
        // A team map only exists inside its session, so being turned away means the
        // map goes too. A personal map keeps its unsaved work and just stays offline.
        // Somebody in the room persisted the state everyone shares, so nobody is
        // holding unsaved work any more.
        onSaved: () => { dirty.current = false; },
        onRefused: (message) => {
            flash(message ?? 'That session turned you away.');
            if (mapTeamRef.current == null) return;
            setTeamOpen(false);
            resetDocument(null, [], false);
        },
    });

    const liveRef = useRef(live);
    liveRef.current = live;
    const canEdit = (!live.live || live.canEdit) && !playing && !viewing;
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
    }, [joining, live.join]);

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
        const grid = await buildVoxels(entry.object, res, solid, resCap);
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
        setBusy(`Reading ${file.name}...`);
        await paint();
        try {
            const object = await loadModel(file);
            const entry = { object, name: file.name };
            loadedModels.current[`${plugin.id}:${ctrlId}`] = entry;
            setBusy(`Building blocks from ${file.name}...`);
            await paint();
            await voxelise(plugin, ctrlId, entry, activeValues);
            flash(`${file.name} ready`);
        } catch (e) {
            flash(`Could not read ${file.name}: ${e.message ?? e}`);
        } finally {
            setBusy(null);
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
        setBusy(`Running ${activePlugin.name}...`);
        await paint();
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
                    if (parts.length >= pluginCap
                        || partsRef.current.length + parts.length >= mapCap) {
                        capped = true;
                        break;
                    }
                    parts.push(fillPart(part, target));
                }
                if (capped) break;
            }
            // The voxel plugin emits bottom-up, so a silent cap beheads the model.
            if (capped) {
                flash(`Too big: stopped at ${mapCap} parts, so the top is missing. `
                    + 'Lower the Detail and run it again.');
            }
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
                runGroupOp({
                    t: 'group',
                    id: newGroupId(),
                    name: label ? `${activePlugin.name}: ${label}` : activePlugin.name,
                    ids: placed.map((p) => p._id),
                });
                flash(`${activePlugin.name} placed ${placed.length} parts, grouped in the explorer`);
            }
        } catch (e) {
            flash(String(e.message ?? e));
        } finally {
            setBusy(null);
        }
    };

    // Applied here and again when the room echoes it back, exactly like part ops:
    // the room's order is the authoritative one, and every group op is idempotent.
    const runGroupOp = useCallback((op) => {
        setGroups((gs) => applyGroupOp(gs, op));
        liveRef.current.sendGroupOp(op);
    }, []);

    const groupSelection = useCallback(() => {
        if (selectedIds.length < 2) return;
        runGroupOp({
            t: 'group', id: newGroupId(), name: `Group ${groupsRef.current.length + 1}`, ids: [...selectedIds],
        });
        flash(`Grouped ${selectedIds.length} parts`);
    }, [selectedIds, flash, runGroupOp]);

    const ungroupSelection = useCallback(() => {
        if (!selectedIds.length) return;
        const next = ungroupIds(groupsRef.current, selectedIds);
        if (next.length !== groupsRef.current.length) flash('Ungrouped');
        runGroupOp({ t: 'ungroup', ids: [...selectedIds] });
    }, [selectedIds, flash, runGroupOp]);

    const ungroup = (groupId) => runGroupOp({ t: 'delete', id: groupId });

    const renameGroup = (groupId, name) => runGroupOp({ t: 'rename', id: groupId, name });

    // Debounced: a gizmo drag changes parts every frame, and pruning at that rate
    // stalls the main thread.
    useEffect(() => {
        const t = setTimeout(() => setGroups((gs) => pruneGroups(gs, parts)), GROUPS_DEBOUNCE_MS);

        return () => clearTimeout(t);
    }, [parts]);

    // Groups ride the normal save now, so a group-only change has to mark the
    // document dirty or autosave never fires for it. The array resetDocument
    // installed is the load itself, and pruneGroups returns its input unchanged
    // when nothing was pruned, so identity is enough to tell an edit apart.
    useEffect(() => {
        if (mapName && groups !== loadedGroups.current) dirty.current = true;
    }, [groups]);

    const changeGraphics = (patch) => {
        setGraphics((g) => {
            const next = { ...g, ...patch };
            saveGraphics(next);
            return next;
        });
    };

    const open = async (name, teamId = null) => {
        // Reloading the open map would throw away unsaved edits, so just show it.
        if (name === mapName && teamId === mapTeamRef.current) {
            setActiveTab('game');
            return;
        }
        if (liveRef.current.live) liveRef.current.leave();
        setBusy(`Loading ${name}.json...`);
        try {
            const doc = await loadMap(name, teamId);
            const ready = resetDocument(name, doc.parts, false, doc.groups, teamId, doc.version);
            // A team map is collaborative by default: everyone who opens it lands in
            // the same room, so there is no code to pass around.
            if (teamId != null) liveRef.current.openTeam(name, ready.parts, ready.groups, teamId);
        } catch (e) {
            flash(String(e.message ?? e));
        } finally {
            setBusy(null);
        }
    };

    // A local backup goes straight back into the editor, dirty, so the next save
    // (manual or auto) puts it on the server again.
    const restore = (name, data) => {
        resetDocument(name, data, true);
        flash(`Restored ${name}.json from this device`);
    };

    const openUploaded = (name, data) => {
        resetDocument(name, data, true);
        flash(`Loaded upload as ${name}.json, Save to keep it`);
    };

    const mapNameFrom = (fileName) => (fileName ?? '')
        .replace(/\.json$/i, '')
        .replace(/[^A-Za-z0-9_-]/g, '-')
        .slice(0, 64) || 'roblox';

    const importRobloxText = (text, fileName) => {
        let result;
        try {
            result = convertRoblox(JSON.parse(text), mapCap - (mapName ? partsRef.current.length : 0));
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
            runGroupOp({
                t: 'group',
                id: newGroupId(),
                name: `Roblox import${fileName ? `: ${fileName}` : ''}`,
                ids: added.map((p) => p._id),
            });
        } else {
            resetDocument(mapNameFrom(fileName), result.parts, true);
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

    const pasteRoblox = async () => {
        const text = await ask({
            title: 'Import a Roblox place',
            body: 'Paste the exported JSON below.',
            multiline: true,
            placeholder: '{ "parts": [ ... ] }',
            confirmLabel: 'Import',
        });
        if (text) importRobloxText(text, null);
    };

    const download = () => {
        if (!mapName) return;
        const blob = new Blob([JSON.stringify(parts)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${mapName}.json`;
        a.click();
        // Firefox cancels the download if the URL is revoked in the same tick.
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };

    const createNew = (name, teamId = null) => {
        // Drain any leftover under this name: its indices would land on the new parts.
        takeLegacyGroups(name, []);
        if (liveRef.current.live) liveRef.current.leave();
        const ready = resetDocument(name, [
            withNewId({ Tr: 0, P: [0, 0, 0], S: [200, 2, 200], R: [0, 0, 0], T: 'Part', Shape: 'Block', C: '7d7d85' }),
            withNewId(NEW_SPAWN),
        ], true, null, teamId, null);
        if (teamId != null) liveRef.current.openTeam(name, ready.parts, ready.groups, teamId);
    };

    const canSaveToServer = !!mapName && (!live.live || live.canEdit) && !viewing;

    // Fire and forget: a picture is never worth failing or delaying a save for.
    const snapThumb = useCallback((name, team, snapshot, force) => {
        if (!thumbRef.current || !snapshot.length) return;
        const now = Date.now();
        if (!force && now - thumbAt.current < THUMB_EVERY_MS) return;
        thumbAt.current = now;
        Promise.resolve()
            .then(() => thumbRef.current(snapshot))
            .then((blob) => blob && putThumb(name, team, blob))
            .catch(() => {});
    }, []);

    const save = useCallback(async (auto) => {
        if (!mapName) return false;
        if (liveRef.current.live && !liveRef.current.canEdit) {
            if (auto !== true) flash('You are a spectator in this session');
            return false;
        }
        const snapshot = partsRef.current;
        const grouped = groupsRef.current;
        // Mirror locally first: the copy that matters most is the one for a save that
        // is about to fail. A save also restarts the server-side 24h TTL for this map.
        const backed = writeBackup(mapName, snapshot);
        try {
            const r = await saveMap(mapName, snapshot, grouped, mapTeamRef.current, versionRef.current);
            versionRef.current = r.version ?? null;
            // Edits made while the request was in flight must stay dirty.
            if (partsRef.current === snapshot) dirty.current = false;
            liveRef.current.notifySaved();
            flash(auto === true ? 'Auto-saved' : `Saved ${mapName}.json`);
            snapThumb(mapName, mapTeamRef.current, snapshot, auto !== true);

            return true;
        } catch (e) {
            // A teammate saved in between. Never retry on its own: that would be the
            // overwrite this check exists to prevent. Autosave says it once and stops.
            if (e.stale) {
                if (!staleSeen.current) flash('Someone else saved this map, reopen it to get their changes');
                staleSeen.current = true;
                return false;
            }
            flash(backed
                ? `Server save failed (${e.message ?? e}), kept a copy on this device`
                : String(e.message ?? e));
            return false;
        }
    }, [mapName, flash, snapThumb]);

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
        live.host(mapName, partsRef.current, groups, mapTeamRef.current);
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

    const closeMap = async () => {
        if (dirty.current) {
            const yes = await confirm({
                title: `Close ${mapName}.json?`,
                body: 'It has changes that are not saved. The local copy in this browser keeps them, but the cloud copy will not.',
                confirmLabel: 'Close anyway',
                danger: true,
            });
            if (!yes) return;
        }
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
        for (const g of clip.groups) {
            const ids = g.slots.map((i) => added[i]?._id).filter(Boolean);
            if (ids.length) runGroupOp({ t: 'group', id: newGroupId(), name: g.name, ids });
        }
    };

    const duplicate = () => {
        if (!selectedParts.length) return;
        const added = addMany(stripIds(selectedParts));
        const fresh = new Map(selectedParts.map((p, i) => [p._id, added[i]._id]));
        for (const g of groupsRef.current) {
            if (!g.ids.every((id) => fresh.has(id))) continue;
            runGroupOp({
                t: 'group', id: newGroupId(), name: `${g.name} copy`, ids: g.ids.map((id) => fresh.get(id)),
            });
        }
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
            if (dirty.current && mapNameRef.current) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    useEffect(() => {
        if (!viewing) return;
        loadMapAsAdmin(viewing)
            .then((m) => {
                resetDocument(m.name, m.parts, false, m.groups ?? []);
                flash(`Viewing ${m.name} as admin, read-only`);
            })
            .catch((e) => flash(String(e.message ?? e)));
    }, [viewing]);

    const [updateReady, setUpdateReady] = useState(false);
    const [updateHidden, setUpdateHidden] = useState(false);

    useEffect(() => watchForUpdate(() => setUpdateReady(true)), []);

    const reloadForUpdate = useCallback(async () => {
        if (dirty.current && canSaveToServer && !await save()) return false;
        // The reload is the answer to a prompt, so it must not raise a second one.
        dirty.current = false;
        window.location.reload();
        return true;
    }, [canSaveToServer, save]);

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
            {dialogs}
            <Busy label={busy} />
            {updateReady && !updateHidden && (
                <UpdateNotice
                    warning={dirty.current && !canSaveToServer && !live.live
                        ? 'This map is not saved on the server, reloading loses your changes.'
                        : null}
                    onReload={reloadForUpdate}
                    onDismiss={() => setUpdateHidden(true)}
                />
            )}
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
                    snap={snap} setSnap={setSnap}
                    hasSelection={!!selected} canEdit={canEdit}
                    onUndo={undo} onRedo={redo}
                    onAddPart={() => addPart(NEW_PART)}
                    onDelete={removeSelected}
                    onSave={save} canSave={canSaveToServer}
                    hasMap={!!mapName}
                    live={live.live}
                    teamOpen={teamOpen}
                    onToggleTeam={() => setTeamOpen((o) => !o)}
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
                account={account} ttl={accountTtl} claimed={claimed}
                onAccountChange={accountChanged}
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
                        onOpen={open} onCreate={createNew} openTeam={mapTeam}
                        account={account} accountSeq={accountSeq}
                        onAccountSeen={(a, t) => { setAccount(a); setAccountTtl(t); }}
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
                        members={live.members}
                        onView={live.live ? live.sendView : null}
                        onTransform={updateSelected}
                        onTransformMany={transformMany}
                        mapName={mapName}
                        graphics={graphics}
                        preview={pluginPreview}
                        spawnRef={spawnRef}
                        busyRef={busyRef}
                        thumbRef={thumbRef}
                        playing={playing}
                        onExitPlay={() => setPlaying(false)}
                        onPlayError={(m) => flash(`Could not start the play test: ${m}`)}
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
                            teamMap={mapTeam != null}
                            teamName={teams.find((t) => t.id === mapTeam)?.name ?? null}
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
