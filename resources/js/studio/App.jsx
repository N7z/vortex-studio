import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MenuBar from './MenuBar';
import Toolbar from './Toolbar';
import MobileBar from './MobileBar';
import TouchControls from './play/TouchControls';
import useIsMobile from './useIsMobile';
import StartScreen from './StartScreen';
import Teams from './Teams';
import Explorer from './Explorer';
import Properties from './Properties';
import Viewport from './Viewport';
import PluginPanel from './PluginPanel';
import TabBar from './TabBar';
import StatsPanel from './StatsPanel';
import TeamPanel from './TeamPanel';
import ChatPanel from './ChatPanel';
import ScriptTab, { TEMPLATE } from './ScriptTab';
import {
    loadPlugins, setPartLimit, setVoxelLimit, setStepBudget, STEP_BUDGET,
    stripId, compilePlugin, saveUserPlugin,
    deleteUserPlugin,
    userPluginSource, isBuiltin, resetBuiltin, onPluginPrint, onPluginProgress,
} from './plugins';
import {
    listTeams, loadAccount, loadMap, loadMapAsAdmin, putThumb, saveBody, saveMap,
} from './api';
import { writeBackup } from './backup';
import {
    ENGINE_MAX_BYTES,
    addOp, applyOp, fillPart, invertOp, patchOp, removeOp, repairParts, stripIds, unsetOp,
    transformOp, withNewId,
} from './ops';
import { DeleteIcon, DuplicateIcon } from './icons';
import { loadGraphics, saveGraphics } from './graphics';
import { continues, editKey, lightingKey } from './history';
import { roomFromUrl } from './live';
import UpdateNotice from './UpdateNotice';
import { watchForUpdate } from './version';
import useLive from './useLive';
import { decodeImage, imageMeta } from './image';
import { MAX_DIM, MAX_RES, buildVoxels, loadModel, voxelCost } from './model';
import { predict, record } from './estimate';
import { convertRoblox, importSummary } from './roblox';
import { fromProject, isProject, newProjectId, toProject } from './vortexProject';
import {
    AMBIENT, DEFAULT_LIGHTING, DEFAULT_POINT_LIGHT, DEFAULT_SPOT_LIGHT, SUN, isLightRef,
    partLightOf, partLightRef, repairLighting,
} from './lighting';
import useDialogs from '../ui/useDialogs';
import Busy from '../ui/Busy';
import {
    applyGroupOp, groupIndex, newGroup, newGroupId, pruneEmptyGroups, pruneGroups, takeLegacyGroups,
    ungroupIds,
} from './groups';
import * as flagStore from './flags';
import { buildGrid, nearGrid } from './partgrid';

const HISTORY_LIMIT = 100;

const remember = (stack, entry) => {
    stack.current.push(entry);
    if (stack.current.length > HISTORY_LIMIT) stack.current.shift();
};

const NEW_PART = {
    Tr: 0, P: [0, 4, 0], S: [4, 1, 2], R: [0, 0, 0],
    T: 'Part', Shape: 'Block', C: 'a3a2a5',
};

const NEW_SPAWN = {
    Tr: 0, P: [0, 1.5, 0], S: [6, 1, 6], R: [0, 0, 0],
    T: 'SpawnLocation', Shape: 'Block', C: '4db84b',
};

const NEW_BASEPLATE = {
    Tr: 0, P: [0, 0, 0], S: [200, 2, 200], R: [0, 0, 0],
    T: 'Part', Shape: 'Block', C: '7d7d85', Bp: true,
    Tx: { Top: 'Studs', Bottom: 'Inlets' },
};

const MAX_PLUGIN_PARTS = 60000;
const modelSig = (c, values) => `${values?.[c.res] ?? ''}/${values?.[c.solid] ?? ''}`;
const VOXEL_DEBOUNCE = 300;
const MAX_MODEL_VOXELS = 400000;

const MAX_MAP_PARTS = 60000;

const MAX_SELECTION_PARTS = 256;

const MAX_BRUSH_PARTS = 200;
const MAX_BRUSH_RADIUS = 500;
const BRUSH_AGAIN = 0.05;

const GROUPS_DEBOUNCE_MS = 400;

const paint = () => new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
});

const THUMB_EVERY_MS = 120_000;

const THUMB_MIN_MS = 15_000;

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
    const modelSigs = useRef({});
    const [groups, setGroups] = useState([]);
    const [lighting, setLighting] = useState(() => ({ ...DEFAULT_LIGHTING }));
    const [flags, setFlags] = useState(flagStore.EMPTY);
    const [tabs, setTabs] = useState([]);
    const [activeTab, setActiveTab] = useState('home');
    const mobile = useIsMobile();
    const [drawer, setDrawer] = useState(false);
    const [drawerTab, setDrawerTab] = useState('explorer');
    const touchRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [died, setDied] = useState(0);
    const [teamOpen, setTeamOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
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
    const lastEdit = useRef({ key: null, at: 0 });
    const groupsRef = useRef([]);
    groupsRef.current = groups;
    const flagsRef = useRef(flags);
    flagsRef.current = flags;
    const loadedGroups = useRef(groups);
    const lightingRef = useRef(lighting);
    lightingRef.current = lighting;
    const loadedLighting = useRef(lighting);
    const projectId = useRef(null);
    const mapNameRef = useRef(null);
    const mapTeamRef = useRef(null);
    mapTeamRef.current = mapTeam;
    const versionRef = useRef(null);
    const staleSeen = useRef(false);
    const thumbRef = useRef(null);
    const thumbAt = useRef(0);
    const { dialogs, confirm, ask } = useDialogs();
    const [busy, setBusy] = useState(null);
    const [building, setBuilding] = useState(null);
    const [unlimited, setUnlimited] = useState(false);
    const [account, setAccount] = useState(null);
    const [accountTtl, setAccountTtl] = useState(24);
    const [claimed, setClaimed] = useState(0);
    const [accountSeq, setAccountSeq] = useState(0);
    const [teamsOpen, setTeamsOpen] = useState(false);
    const mapCap = unlimited ? Infinity : MAX_MAP_PARTS;
    const pluginCap = unlimited ? Infinity : MAX_PLUGIN_PARTS;
    const resCap = unlimited ? MAX_DIM : MAX_RES;

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
        setVoxelLimit(unlimited ? Number.MAX_SAFE_INTEGER : MAX_MODEL_VOXELS);
        setStepBudget(unlimited ? 0 : STEP_BUDGET);
    }, [unlimited]);

    const flash = useCallback((msg) => {
        setStatus(msg);
        setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2500);
    }, []);

    useEffect(() => onPluginPrint(flash), [flash]);

    const resetDocument = (
        name, raw, isDirty, remoteGroups, teamId = null, version = null,
        remoteLighting = null, remoteProjectId = null,
    ) => {
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
        const rig = repairLighting(remoteLighting);
        loadedLighting.current = rig;
        setLighting(rig);
        projectId.current = remoteProjectId ?? (name ? newProjectId() : null);
        const legacy = remoteGroups?.length ? [] : takeLegacyGroups(name, data);
        const next = legacy.length ? legacy : (remoteGroups ?? []);
        loadedGroups.current = next;
        setGroups(next);
        history.current = [];
        future.current = [];
        dirty.current = isDirty || fixed > 0 || legacy.length > 0;
        setFlags(flagStore.prune(flagStore.load(flagStore.mapKey(name, teamId)), data));

        return { parts: data, groups: next, lighting: rig };
    };

    const live = useLive({
        onWelcome: (msg) => {
            setJoining(null);
            if (msg.resumed) {
                const alive = new Set(msg.parts.map((p) => p._id));
                setParts(msg.parts);
                setGroups(msg.groups ?? []);
                setLighting(repairLighting(msg.lighting));
                setSelectedIds((cur) => cur.filter((id) => alive.has(id)));
            } else {
                if (mapTeamRef.current == null) setTeamOpen(true);
                resetDocument(msg.mapName, msg.parts, false, msg.groups ?? [],
                    mapTeamRef.current, versionRef.current, msg.lighting, projectId.current);
            }
            if (mapTeamRef.current != null) {
                flash(msg.resumed ? 'Back with the team' : `Editing with the team as ${msg.you.name}`);
            } else {
                flash(msg.resumed
                    ? `Back in session ${msg.code}`
                    : `Live session ${msg.code} as ${msg.you.name}`);
            }
        },
        onOp: (msg) => {
            setParts((ps) => applyOp(ps, msg.op));
            if (liveRef.current?.canEdit) dirty.current = true;
        },
        onSnapshot: (msg) => {
            setParts(msg.parts);
            if (msg.groups) {
                setGroups(msg.groups);
            }
            if (msg.lighting) setLighting(repairLighting(msg.lighting));
            history.current = [];
            future.current = [];
        },
        onGroups: (msg) => {
            setGroups(msg.groups);
        },
        onLighting: (msg) => {
            setLighting(repairLighting(msg.lighting));
            if (liveRef.current?.canEdit) dirty.current = true;
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

    const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selected = useMemo(
        () => parts.find((p) => p._id === selectedId) ?? null,
        [parts, selectedId],
    );
    const selectedParts = useMemo(() => (
        selectedIds.length > 1
            ? parts.filter((p) => selectedSet.has(p._id))
            : (selected ? [selected] : [])
    ), [parts, selectedSet, selected]);
    // Either half of the rig can be selected, and neither is a part, so it is the name that is held.
    const selectedLight = useMemo(() => {
        const last = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;

        return isLightRef(last) ? last : null;
    }, [selectedIds]);

    // A light on a part, on the other hand, is edited through the part that carries it.
    const selectedPartLight = useMemo(() => {
        const last = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;

        return partLightOf(last);
    }, [selectedIds]);
    const partLightHost = useMemo(() => (
        selectedPartLight ? parts.find((p) => p._id === selectedPartLight.partId) ?? null : null
    ), [parts, selectedPartLight]);

    const addUnderPart = useCallback((partId, kind) => {
        if (!canEditRef.current) return;
        const key = kind === 'spot' ? 'spot_light' : 'point_light';
        const value = kind === 'spot' ? DEFAULT_SPOT_LIGHT : DEFAULT_POINT_LIGHT;
        edit(patchOp([partId], { [key]: { ...value } }));
        setSelectedIds([partLightRef(partId, kind)]);
    }, []);
    const pluginTarget = selected;
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

    const select = useCallback((id, additive, normal, solo) => {
        const lit = partLightOf(id);
        if (lit) {
            // Lights on parts gather the way parts do, as long as they are the same kind of light:
            // a point and a spot have nothing in common to edit together.
            setSelectedIds((cur) => {
                const kept = additive
                    ? cur.filter((x) => partLightOf(x)?.kind === lit.kind)
                    : [];
                if (kept.includes(id)) return kept.filter((x) => x !== id);

                return [...kept, id];
            });
            setFaces({});

            return;
        }
        if (isLightRef(id)) {
            setSelectedIds([id]);
            setFaces({});

            return;
        }
        if (id != null && !flagStore.selectable(flagsRef.current, [id]).length) return;
        const group = id != null && !solo ? groupIndex(groupsRef.current).get(id) : null;
        const ids = group ? flagStore.selectable(flagsRef.current, group.ids) : null;
        setSelectedIds((all) => {
            const cur = all.filter((x) => !isLightRef(x) && !partLightOf(x));
            if (id == null) return additive ? cur : [];
            if (ids?.length) {
                if (!additive) return [...ids];
                const has = new Set(cur);
                if (ids.every((x) => has.has(x))) {
                    const drop = new Set(ids);
                    return cur.filter((x) => !drop.has(x));
                }
                return [...cur, ...ids.filter((x) => !has.has(x))];
            }
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
        const free = flagStore.selectable(
            flagsRef.current, ids.filter((id) => !isLightRef(id) && !partLightOf(id)),
        );
        setSelectedIds((cur) => {
            if (!additive) return [...free];
            const kept = cur.filter((x) => !isLightRef(x) && !partLightOf(x));
            const seen = new Set(kept);
            return [...kept, ...free.filter((id) => !seen.has(id))];
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
            // Still the same move? The entry already on the stack undoes the whole of it.
            const key = editKey(op);
            const now = performance.now();
            const same = continues(lastEdit.current, key, now) && history.current.length;
            lastEdit.current = { key, at: now };
            if (!same) {
                remember(history, { t: 'parts', op: inverse });
                future.current = [];
            }
        }
        dirty.current = true;
        setParts(next);
        liveRef.current.sendOp(op);
    }, [flash]);

    const step = useCallback((from, to) => {
        const entry = from.current.pop();
        if (!entry) return;
        // Whatever comes next starts its own move, even if it touches the same field again.
        lastEdit.current = { key: null, at: 0 };

        if (entry.t === 'lighting') {
            remember(to, { t: 'lighting', lighting: lightingRef.current });
            dirty.current = true;
            setLighting(entry.lighting);
            liveRef.current.sendLighting(entry.lighting);

            return;
        }

        if (entry.t === 'groups') {
            remember(to, { t: 'groups', groups: groupsRef.current });
            dirty.current = true;
            setGroups(entry.groups);
            liveRef.current.sendGroups(entry.groups);

            return;
        }

        const before = partsRef.current;
        const next = applyOp(before, entry.op);
        if (next === before) return;

        const inverse = invertOp(before, entry.op);
        if (inverse) remember(to, { t: 'parts', op: inverse });
        dirty.current = true;
        setParts(next);
        liveRef.current.sendOp(entry.op);
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

    const voxelise = async (plugin, ctrlId, entry, values, label = null) => {
        const control = plugin.ui.find((c) => c.id === ctrlId);
        const res = Number(values?.[control?.res]) || 32;
        const solid = !!values?.[control?.solid];
        modelSigs.current[`${plugin.id}:${ctrlId}`] = modelSig(control, values);
        const units = voxelCost(entry.object, res, resCap);
        if (label) {
            setBusy({ label, estimate: predict('voxelise', units), progress: 0 });
            await paint();
        }
        const from = performance.now();
        const estimate = predict('voxelise', units);
        let grid;
        try {
            grid = await buildVoxels(entry.object, res, solid, resCap, label
                ? (p) => setBusy({ label, estimate, progress: p })
                : null);
        } finally {
            if (label) setBusy(null);
        }
        record('voxelise', units, performance.now() - from);
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
            await voxelise(plugin, ctrlId, entry, activeValues, `Building blocks from ${file.name}...`);
            flash(`${file.name} ready`);
        } catch (e) {
            flash(`Could not read ${file.name}: ${e.message ?? e}`);
        } finally {
            setBusy(null);
        }
    };

    useEffect(() => {
        if (!activePlugin) return undefined;
        const jobs = [];
        for (const c of activePlugin.ui) {
            if (c.type !== 'model') continue;
            const key = `${activePlugin.id}:${c.id}`;
            const entry = loadedModels.current[key];
            if (!entry || modelSigs.current[key] === modelSig(c, activeValues)) continue;
            jobs.push({ c, entry });
        }
        if (!jobs.length) return undefined;
        const timer = setTimeout(() => {
            for (const { c, entry } of jobs) {
                voxelise(activePlugin, c.id, entry, activeValues, 'Rebuilding blocks...').catch((e) => {
                    flash(`Could not voxelise: ${e.message ?? e}`);
                });
            }
        }, VOXEL_DEBOUNCE);

        return () => clearTimeout(timer);
    }, [activePlugin, activeValues]);

    const brushRadius = activePlugin?.usesBrush
        ? Math.min(MAX_BRUSH_RADIUS, Math.max(0, Number(activeValues?.radius) || 0))
        : 0;
    const brushPainted = useRef(new Map());
    const brushPending = useRef(null);
    const brushBusy = useRef(false);
    const brushGrid = useRef(null);
    const tintRef = useRef(null);

    const commitBrush = () => {
        const pending = brushPending.current;
        brushPending.current = null;
        if (!pending?.size) return;
        edit(transformOp([...pending.values()]));
    };

    const brushStroke = async (at, phase) => {
        if (phase !== 'move') brushPainted.current = new Map();
        if (phase === 'end') {
            commitBrush();
            return;
        }
        if (phase === 'start') brushPending.current = new Map();
        if (!activePlugin?.usesBrush || !at || !canEdit || brushRadius <= 0) return;
        if (brushBusy.current || !brushPending.current) return;
        brushBusy.current = true;
        try {
            if (brushGrid.current?.parts !== partsRef.current) {
                brushGrid.current = buildGrid(partsRef.current);
            }
            const center = [at.x, at.y, at.z];
            const done = brushPainted.current;
            const hits = [];
            nearGrid(brushGrid.current, center, brushRadius, (part, d) => {
                const had = done.get(part._id);
                if (had !== undefined && d >= had - BRUSH_AGAIN) return true;
                done.set(part._id, d);
                hits.push({ part, d });
                return hits.length < MAX_BRUSH_PARTS;
            });
            if (!hits.length) return;
            const free = new Set(flagStore.selectable(
                flagsRef.current, hits.map((h) => h.part._id),
            ));
            await activePlugin.setBrush({ center, radius: brushRadius });
            const updates = [];
            for (const { part, d } of hits) {
                if (!free.has(part._id)) continue;
                const patch = await activePlugin.paint(
                    { ...stripId(part), D: Math.round(d * 1000) / 1000 }, activeValues,
                );
                if (patch) updates.push({ id: part._id, ...patch });
            }
            if (!updates.length) return;
            for (const u of updates) brushPending.current?.set(u.id, u);
            tintRef.current?.(updates);
        } catch (e) {
            brushPainted.current = new Set();
            flash(String(e.message ?? e));
        } finally {
            brushBusy.current = false;
        }
    };

    const pluginButton = async (btnId) => {
        if (!activePlugin || !selectedParts.length) return;
        const voxels = Object.values(pluginModels[activePlugin.id] ?? {})
            .reduce((n, m) => n + (m?.count ?? 0), 0);
        const kind = voxels > 0 ? `run:${activePlugin.id}:voxels` : `run:${activePlugin.id}:parts`;
        const units = voxels > 0 ? voxels * selectedParts.length : selectedParts.length;
        const started = performance.now();
        const label = `Running ${activePlugin.name}...`;
        const estimate = predict(kind, units);
        setBusy({ label, estimate, progress: 0 });
        await paint();
        let failed = false;
        let done = 0;
        const total = selectedParts.length;
        onPluginProgress((p) => {
            setBusy({ label, estimate, progress: (done + p) / total });
        });
        try {
            const parts = [];
            const updates = [];
            let capped = false;
            await activePlugin.setSelection(selectionInfo);
            for (const target of selectedParts) {
                const made = await activePlugin.click(btnId, stripId(target), activeValues);
                done += 1;
                setBusy({ label, estimate, progress: done / total });
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
            failed = true;
            flash(String(e.message ?? e));
        } finally {
            onPluginProgress(null);
            if (!failed) record(kind, units, performance.now() - started);
            setBusy(null);
        }
    };

    // Folders go on the undo stack whole: they are a handful of names and id lists, so keeping the
    // previous state costs nothing and grouping, renaming and ungrouping all undo the same way.
    const runGroupOp = useCallback((op) => {
        remember(history, { t: 'groups', groups: groupsRef.current });
        future.current = [];
        lastEdit.current = { key: null, at: 0 };
        setGroups((gs) => applyGroupOp(gs, op));
        liveRef.current.sendGroupOp(op);
    }, []);

    // A whole tree at once, for when sending it group by group would pass through states where a
    // parent has nothing in it yet.
    const replaceGroups = useCallback((next) => {
        remember(history, { t: 'groups', groups: groupsRef.current });
        future.current = [];
        setGroups(next);
        liveRef.current.sendGroups(next);
    }, []);

    const commitLighting = useCallback((next, key = null) => {
        const now = performance.now();
        const same = continues(lastEdit.current, key, now) && history.current.length;
        lastEdit.current = { key, at: now };
        if (!same) {
            remember(history, { t: 'lighting', lighting: lightingRef.current });
            future.current = [];
        }
        setLighting(next);
        dirty.current = true;
        liveRef.current.sendLighting(next);
    }, []);

    const patchLighting = useCallback((patch) => {
        if (!canEditRef.current) return;
        commitLighting(
            { ...lightingRef.current, ...patch },
            lightingKey(patch),
        );
    }, [commitLighting]);

    const groupSelection = useCallback(() => {
        if (selectedIds.length < 2) return;
        // Grouping parts that all sit in one group nests the new group inside it, rather than
        // pulling them out to the top level.
        const byPart = groupIndex(groupsRef.current);
        const homes = new Set(selectedIds.map((id) => byPart.get(id)?.id ?? null));
        const parent = homes.size === 1 ? [...homes][0] : null;
        runGroupOp({
            t: 'group',
            id: newGroupId(),
            name: `Group ${groupsRef.current.length + 1}`,
            ids: [...selectedIds],
            ...(parent ? { parent } : {}),
        });
        flash(parent ? `Grouped ${selectedIds.length} parts inside` : `Grouped ${selectedIds.length} parts`);
    }, [selectedIds, flash, runGroupOp]);

    const ungroupSelection = useCallback(() => {
        if (!selectedIds.length) return;
        const next = ungroupIds(groupsRef.current, selectedIds);
        if (next.length !== groupsRef.current.length) flash('Ungrouped');
        runGroupOp({ t: 'ungroup', ids: [...selectedIds] });
    }, [selectedIds, flash, runGroupOp]);

    const ungroup = (groupId) => runGroupOp({ t: 'delete', id: groupId });

    const reparentGroup = (groupId, parent) => runGroupOp({ t: 'reparent', id: groupId, parent });

    // Dropping parts on a folder files them there; dropping them on the workspace takes them out.
    const filePartsUnder = (ids, groupId) => {
        const live = ids.filter((id) => partsRef.current.some((p) => p._id === id));
        if (!live.length) return;
        if (!groupId) {
            runGroupOp({ t: 'ungroup', ids: live });

            return;
        }
        const g = groupsRef.current.find((x) => x.id === groupId);
        if (!g) return;
        runGroupOp({
            t: 'group',
            id: g.id,
            name: g.name,
            ids: [...new Set([...g.ids, ...live])],
            ...(g.parent ? { parent: g.parent } : {}),
        });
    };

    const renameGroup = (groupId, name) => runGroupOp({ t: 'rename', id: groupId, name });

    useEffect(() => {
        const t = setTimeout(() => setGroups((gs) => pruneGroups(gs, parts)), GROUPS_DEBOUNCE_MS);

        return () => clearTimeout(t);
    }, [parts]);

    useEffect(() => {
        if (mapName && groups !== loadedGroups.current) dirty.current = true;
    }, [groups]);

    useEffect(() => {
        if (mapName && lighting !== loadedLighting.current) dirty.current = true;
    }, [lighting]);

    const changeGraphics = (patch) => {
        setGraphics((g) => {
            const next = { ...g, ...patch };
            saveGraphics(next);
            return next;
        });
    };

    const open = async (name, teamId = null) => {
        if (name === mapName && teamId === mapTeamRef.current) {
            setActiveTab('game');
            return;
        }
        if (liveRef.current.live) liveRef.current.leave();
        setBusy(`Loading ${name}.json...`);
        try {
            const doc = await loadMap(name, teamId);
            const ready = resetDocument(
                name, doc.parts, false, doc.groups, teamId, doc.version, doc.lighting, doc.projectId,
            );
            if (teamId != null) {
                liveRef.current.openTeam(name, ready.parts, ready.groups, teamId, ready.lighting);
            }
        } catch (e) {
            flash(String(e.message ?? e));
        } finally {
            setBusy(null);
        }
    };

    const restore = (name, doc) => {
        resetDocument(
            name, doc.parts, true, doc.groups ?? null, null, null,
            doc.lighting ?? null, doc.projectId ?? null,
        );
        flash(`Restored ${name}.json from this device`);
    };

    const openUploaded = (name, data, incoming = null, doc = null) => {
        if (incoming?.length) {
            const seeded = data.map(withNewId);
            const groups = incoming
                .map((g) => newGroup(g.name, g.slots.map((i) => seeded[i]?._id).filter(Boolean)))
                .filter((g) => g.ids.length);
            resetDocument(name, seeded, true, groups, null, null, doc?.lighting, doc?.projectId);
        } else {
            resetDocument(name, data, true, null, null, null, doc?.lighting, doc?.projectId);
        }
        flash(`Loaded upload as ${name}.json, Save to keep it`);
    };

    const mapNameFrom = (fileName) => (fileName ?? '')
        .replace(/\.json$/i, '')
        .replace(/[^A-Za-z0-9_-]/g, '-')
        .slice(0, 64) || 'roblox';

    const importRobloxText = (text, fileName) => {
        let result;
        try {
            const doc = JSON.parse(text);
            const room = mapCap - (mapName ? partsRef.current.length : 0);
            result = isProject(doc) ? fromProject(doc, room) : convertRoblox(doc, room);
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
            if (result.groups?.length) {
                const idFor = new Map(result.groups.map((g) => [g.at, newGroupId()]));
                const imported = result.groups.map((g) => ({
                    id: idFor.get(g.at),
                    name: g.name,
                    ids: g.slots.map((i) => added[i]?._id).filter(Boolean),
                    ...(g.parentAt === null ? {} : { parent: idFor.get(g.parentAt) }),
                }));
                replaceGroups(pruneEmptyGroups([...groupsRef.current, ...imported]));
            } else {
                runGroupOp({
                    t: 'group',
                    id: newGroupId(),
                    name: `Roblox import${fileName ? `: ${fileName}` : ''}`,
                    ids: added.map((p) => p._id),
                });
            }
        } else {
            const seeded = result.parts.map(withNewId);
            const groups = (result.groups ?? [])
                .map((g) => newGroup(g.name, g.slots.map((i) => seeded[i]?._id).filter(Boolean)))
                .filter((g) => g.ids.length);
            resetDocument(
                mapNameFrom(fileName), seeded, true, groups, null, null,
                result.lighting ?? null, result.projectId ?? null,
            );
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
        const text = JSON.stringify(toProject(parts, groups, projectId.current ?? newProjectId(), lighting));
        if (text.length > ENGINE_MAX_BYTES) {
            flash(`This map is ${(text.length / 1048576).toFixed(1)} MB, over the 10 MB the game `
                + 'accepts. Rebuild it with a lower Detail or a higher Merge angle.');
        }
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${mapName}.json`;
        a.click();
        // Firefox cancels the download if the URL is revoked in the same tick.
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };

    const createNew = (name, teamId = null) => {
        // drain any leftover under this name: its indices would land on the new parts.
        takeLegacyGroups(name, []);
        if (liveRef.current.live) liveRef.current.leave();
        const ready = resetDocument(name, [
            withNewId(NEW_BASEPLATE),
            withNewId(NEW_SPAWN),
        ], true, null, teamId, null, [newLight(DEFAULT_SUN)], null);
        if (teamId != null) {
            liveRef.current.openTeam(name, ready.parts, ready.groups, teamId, ready.lighting);
        }
    };

    const canSaveToServer = !!mapName && (!live.live || live.canEdit) && !viewing;

    const snapThumb = useCallback((name, team, snapshot, force) => {
        if (!thumbRef.current || !snapshot.length) return;
        const now = Date.now();
        const wait = force ? THUMB_MIN_MS : THUMB_EVERY_MS;
        if (now - thumbAt.current < wait) return;
        thumbAt.current = now;
        Promise.resolve()
            .then(() => thumbRef.current(snapshot))
            .then((blob) => blob && putThumb(name, team, blob))
            .catch(() => {});
    }, []);

    const save = useCallback(async (auto, confirmed = false) => {
        if (!mapName) return false;
        if (liveRef.current.live && !liveRef.current.canEdit) {
            if (auto !== true) flash('You are a spectator in this session');
            return false;
        }
        const snapshot = partsRef.current;
        const grouped = groupsRef.current;
        const lit = lightingRef.current;
        const project = projectId.current;
        const body = saveBody(snapshot, grouped, versionRef.current, lit, project);
        const backed = writeBackup(mapName, snapshot, body);
        try {
            const r = await saveMap(
                mapName, snapshot, grouped, mapTeamRef.current, versionRef.current, body, confirmed,
                lit, project,
            );
            versionRef.current = r.version ?? null;
            if (partsRef.current === snapshot) dirty.current = false;
            liveRef.current.notifySaved();
            flash(auto === true ? 'Auto-saved' : `Saved ${mapName}.json`);
            snapThumb(mapName, mapTeamRef.current, snapshot, auto !== true);

            return true;
        } catch (e) {
            if (e.stale) {
                if (!staleSeen.current) flash('Someone else saved this map, reopen it to get their changes');
                staleSeen.current = true;
                return false;
            }
            if (e.destructive) {
                const yes = await confirm({
                    title: `Save ${mapName}.json with ${e.now} parts?`,
                    body: `This map has ${e.was} parts in the cloud and this save keeps ${e.now}.`
                        + ' Everyone in the team gets this copy. The version before it is kept,'
                        + ' so it can be put back from History.',
                    confirmLabel: 'Save anyway',
                    danger: true,
                });
                if (!yes) return false;

                return save(auto, true);
            }
            flash(backed
                ? `Server save failed (${e.message ?? e}), kept a copy on this device`
                : String(e.message ?? e));
            return false;
        }
    }, [mapName, flash, snapThumb, confirm]);

    useEffect(() => {
        if (!mapName) return;
        const t = setInterval(() => {
            if (dirty.current) save(true);
        }, 20_000);
        return () => clearInterval(t);
    }, [mapName, save]);

    const goLive = () => {
        if (!mapName) return;
        live.host(mapName, partsRef.current, groups, mapTeamRef.current, lightingRef.current);
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

    useEffect(() => {
        flagStore.save(flagStore.mapKey(mapName, mapTeam), flags);
    }, [flags, mapName, mapTeam]);

    const setFlag = useCallback((kind, ids, on) => {
        setFlags((cur) => flagStore.apply(cur, kind, ids, on));
        if (on) {
            const drop = new Set(ids);
            setSelectedIds((cur) => cur.filter((id) => !drop.has(id)));
        }
    }, []);

    const clearFlag = useCallback((kind) => setFlags((cur) => flagStore.clear(cur, kind)), []);

    const visibleParts = useMemo(
        () => (flags.hide.size ? parts.filter((p) => !flagStore.isHidden(flags, p)) : parts),
        [parts, flags],
    );

    const updateSelected = (patch) => {
        if (patch.N === null) {
            edit(unsetOp(selectedIds, ['N']));

            return;
        }
        const lit = partLightOf(selectedIds[selectedIds.length - 1]);
        if (lit) {
            const hosts = selectedIds
                .map(partLightOf)
                .filter((x) => x?.kind === lit.kind)
                .map((x) => x.partId);
            const gone = Object.entries(patch).filter(([, v]) => v === null).map(([k]) => k);
            if (gone.length) {
                edit(unsetOp(hosts, gone));
                setSelectedIds(hosts);

                return;
            }
            edit(patchOp(hosts, patch));

            return;
        }
        if (!selectedIds.length) return;
        edit(patchOp(selectedIds, patch));
    };

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
        // Delete on a light takes the light off the part, not the part out of the map. The two
        // halves of the map's own rig cannot be deleted at all.
        const lit = partLightOf(selectedIds[selectedIds.length - 1]);
        if (lit) {
            const hosts = selectedIds
                .map(partLightOf)
                .filter((x) => x?.kind === lit.kind)
                .map((x) => x.partId);
            edit(unsetOp(hosts, [lit.kind === 'spot' ? 'spot_light' : 'point_light']));
            setSelectedIds(hosts);

            return;
        }
        const parts = selectedIds.filter((id) => !isLightRef(id));
        if (!parts.length) return;
        edit(removeOp(parts));
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
                resetDocument(m.name, m.parts, false, m.groups ?? [], null, null, m.lighting ?? m.lights ?? null);
                flash(`Viewing ${m.name} as admin, read-only`);
            })
            .catch((e) => flash(String(e.message ?? e)));
    }, [viewing]);

    const [updateReady, setUpdateReady] = useState(false);
    const [updateHidden, setUpdateHidden] = useState(false);

    useEffect(() => watchForUpdate(() => setUpdateReady(true)), []);

    const reloadForUpdate = useCallback(async () => {
        if (dirty.current && canSaveToServer && !await save()) return false;
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
            // Undo and redo belong to the map wherever the focus happens to be: a slider or a
            // property box would otherwise hand them to the browser's own undo for that field.
            // A textarea keeps them, since that is a script being written.
            const typing = e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
            if (!typing && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                e.target.blur?.();
                undo();

                return;
            }
            if (!typing && e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                e.preventDefault();
                e.target.blur?.();
                redo();

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
                selectMany(partsRef.current.map((p) => p._id));
            }
            else if (!e.ctrlKey && e.key.toLowerCase() === 'h') {
                if (e.shiftKey) clearFlag('hide');
                else if (selectedIds.length) setFlag('hide', selectedIds, true);
            }
            else if (!e.ctrlKey && e.key.toLowerCase() === 'l') {
                if (e.shiftKey) clearFlag('lock');
                else if (selectedIds.length) setFlag('lock', selectedIds, true);
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
        groupSelection, ungroupSelection, playing, mapName, selectMany, setFlag, clearFlag]);

    return (
        <div className={mobile ? 'studio mobile' : 'studio'}>
            {dialogs}
            <Busy
                label={busy ?? (building == null ? null : {
                    label: 'Building the map...',
                    progress: building,
                })}
            />
            {teamsOpen && (
                <Teams
                    teams={teams}
                    me={account?.id}
                    onChanged={() => {
                        listTeams().then((d) => setTeams(d.teams ?? []));
                        setAccountSeq((n) => n + 1);
                    }}
                    onClose={() => setTeamsOpen(false)}
                />
            )}
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
                onSelectAll={() => selectMany(partsRef.current.map((p) => p._id))}
                onGroup={groupSelection} onUngroup={ungroupSelection}
                onAddPart={() => addPart(NEW_PART)}
                onAddSpawn={() => addPart(NEW_SPAWN)}
                graphics={graphics} onGraphics={changeGraphics}
                teamOpen={teamOpen} onToggleTeam={() => setTeamOpen((o) => !o)}
                chatOpen={chatOpen} onToggleChat={() => setChatOpen((o) => !o)} canChat={live.live}
                statsOpen={statsOpen} onToggleStats={() => setStatsOpen((o) => !o)}
                plugins={plugins} activePluginId={activePluginId}
                onTogglePlugin={togglePlugin} onNewPlugin={openNewPluginTab}
                account={account} onTeams={() => setTeamsOpen(true)}
                onHide={() => setFlag('hide', selectedIds, true)}
                onLock={() => setFlag('lock', selectedIds, true)}
                onShowAll={() => clearFlag('hide')}
                onUnlockAll={() => clearFlag('lock')}
                hiddenCount={flags.hide.size} lockedCount={flags.lock.size}
            />
            {mobile ? (mapName && activeTab === 'game' && (
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
            )) : (
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
                        ttl={accountTtl} claimed={claimed}
                        onAccountChange={accountChanged}
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
                        lighting={lighting}
                        onSunRotate={(sun_rotation) => patchLighting({ sun_rotation })}
                        brush={brushRadius > 0 && !playing ? { radius: brushRadius } : null}
                        onBrush={brushStroke}
                        tintRef={tintRef}
                        statsRef={statsRef}
                        onBuild={setBuilding}
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
                        onPlayDeath={() => setDied((n) => n + 1)}
                        touchRef={touchRef}
                        flags={flags}
                        groups={groups}
                        playRef={live.live ? live.playRef : null}
                        onPlayState={live.live ? live.sendPlay : null}
                    />
                    {mobile && playing && (
                        <TouchControls inputRef={touchRef} onExit={() => setPlaying(false)} />
                    )}
                    {playing && died > 0 && <div className="play-died" key={died} />}
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
                            targetNote={activePlugin.usesBrush
                                ? 'Hold the left mouse button in the viewport to paint'
                                : (selectedParts.length > 1
                                    ? `Runs on all ${selectedParts.length} selected parts`
                                    : null)}
                            onButton={pluginButton}
                            resCap={resCap}
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
                            chatOpen={chatOpen}
                            onToggleChat={() => setChatOpen((o) => !o)}
                            onClose={() => setTeamOpen(false)}
                        />
                    )}
                    {chatOpen && live.live && (
                        <ChatPanel live={live} onClose={() => setChatOpen(false)} />
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
                            flags={flags}
                            onFlag={setFlag}
                            onClearFlags={clearFlag}
                            lighting={lighting}
                            onAddPart={canEdit && mapName ? addPart : null}
                            onAddUnder={canEdit ? addUnderPart : null}
                            onReparent={canEdit ? reparentGroup : null}
                            onFilePartsUnder={canEdit ? filePartsUnder : null}
                            onRenamePart={canEdit ? ((id, N) => edit(patchOp([id], { N }))) : null}
                            NEW_PART={NEW_PART}
                        />
                    )}
                    {(!mobile || drawerTab === 'properties') && (
                        <Properties
                            count={selectedIds.length}
                            onChange={updateSelected}
                            readOnly={!canEdit}
                            part={partLightHost ?? selected}
                            partLight={selectedPartLight?.kind ?? null}
                            light={selectedLight}
                            lighting={lighting}
                            onLightChange={patchLighting}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
