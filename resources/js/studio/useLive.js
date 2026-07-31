import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveToken } from './api';
import { LiveClient } from './live';

const EMPTY = [];

export default function useLive({
    onWelcome, onOp, onSnapshot, onGroups, onError, onNotice,
}) {
    const [status, setStatus] = useState('offline');
    const [code, setCode] = useState(null);
    const [me, setMe] = useState(null);
    const [members, setMembers] = useState(EMPTY);
    const [lastSavedAt, setLastSavedAt] = useState(null);

    const cbs = useRef({});
    cbs.current = { onWelcome, onOp, onSnapshot, onGroups, onError, onNotice };

    const playRef = useRef(new Map());
    const [playingIds, setPlayingIds] = useState(EMPTY);

    const notePlay = (id, play) => {
        const map = playRef.current;
        const had = map.has(id);
        if (play) map.set(id, play);
        else map.delete(id);
        if (had !== !!play) setPlayingIds([...map.keys()]);
    };

    const syncPlay = (list) => {
        const map = playRef.current;
        const ids = new Set(list.map((m) => m.id));
        let changed = false;
        for (const id of [...map.keys()]) {
            if (ids.has(id)) continue;
            map.delete(id);
            changed = true;
        }
        for (const m of list) {
            if (!m.play || map.has(m.id)) continue;
            map.set(m.id, m.play);
            changed = true;
        }
        if (changed) setPlayingIds([...map.keys()]);
    };

    const client = useRef(null);
    if (!client.current) {
        client.current = new LiveClient({
            onStatus: (s) => setStatus(s),
            onWelcome: (msg) => {
                setCode(msg.code);
                setMe(msg.you);
                setMembers(msg.members);
                syncPlay(msg.members.filter((m) => m.id !== msg.you.id));
                setLastSavedAt(msg.lastSavedAt ?? null);
                cbs.current.onWelcome?.(msg);
            },
            onMembers: (msg) => {
                setMembers(msg.members);
                syncPlay(msg.members);
                setMe((cur) => {
                    const mine = msg.members.find((m) => m.id === cur?.id);

                    return mine ? { ...cur, role: mine.role, owner: mine.owner } : cur;
                });
            },
            onYou: (msg) => setMe((cur) => (cur ? { ...cur, role: msg.role, owner: msg.owner } : cur)),
            onOp: (msg) => cbs.current.onOp?.(msg),
            onSnapshot: (msg) => cbs.current.onSnapshot?.(msg),
            onGroups: (msg) => cbs.current.onGroups?.(msg),
            onSelection: (msg) => setMembers((ms) => ms.map(
                (m) => (m.id === msg.id ? { ...m, selection: msg.selection } : m),
            )),
            onView: (msg) => setMembers((ms) => ms.map(
                (m) => (m.id === msg.id ? { ...m, view: msg.view } : m),
            )),
            onPlay: (msg) => notePlay(msg.id, msg.play),
            onSaved: (msg) => setLastSavedAt(msg.at),
            onKicked: (msg) => {
                setCode(null);
                setMe(null);
                setMembers(EMPTY);
                cbs.current.onNotice?.(msg.reason);
            },
            onGone: () => {
                setCode(null);
                setMe(null);
                setMembers(EMPTY);
                syncPlay([]);
            },
            onError: (message) => cbs.current.onError?.(message),
            onIdentity: () => liveToken(),
        });
    }

    const host = useCallback((mapName, parts, groups) => {
        client.current.create(mapName, parts, groups);
    }, []);

    const join = useCallback((joinCode) => {
        client.current.join(joinCode);
    }, []);

    const leave = useCallback(() => {
        client.current.leave();
        setCode(null);
        setMe(null);
        setMembers(EMPTY);
        setLastSavedAt(null);
    }, []);

    const sendOp = useCallback((op) => client.current.sendOp(op), []);
    const sendGroups = useCallback((groups) => client.current.sendGroups(groups), []);
    const sendSelection = useCallback((ids) => client.current.sendSelection(ids), []);
    const sendView = useCallback((view) => client.current.sendView(view), []);
    const sendPlay = useCallback((play) => client.current.sendPlay(play), []);
    const setRole = useCallback((id, role) => client.current.setRole(id, role), []);
    const kick = useCallback((id) => client.current.kick(id), []);
    const notifySaved = useCallback(() => client.current.notifySaved(), []);

    useEffect(() => () => client.current.leave(), []);

    const live = !!code;
    const isOwner = !!me?.owner;
    const canEdit = isOwner || me?.role === 'developer';

    const peers = useMemo(
        () => members.filter((m) => m.id !== me?.id && (m.selection?.length || m.view)),
        [members, me],
    );

    return {
        live,
        status,
        code,
        me,
        members,
        peers,
        playRef,
        playingIds,
        isOwner,
        canEdit,
        lastSavedAt,
        host,
        join,
        leave,
        sendOp,
        sendGroups,
        sendSelection,
        sendView,
        sendPlay,
        setRole,
        kick,
        notifySaved,
    };
}
