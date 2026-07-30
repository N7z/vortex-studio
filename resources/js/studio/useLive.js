import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

    const client = useRef(null);
    if (!client.current) {
        client.current = new LiveClient({
            onStatus: (s) => setStatus(s),
            onWelcome: (msg) => {
                setCode(msg.code);
                setMe(msg.you);
                setMembers(msg.members);
                setLastSavedAt(msg.lastSavedAt ?? null);
                cbs.current.onWelcome?.(msg);
            },
            onMembers: (msg) => {
                setMembers(msg.members);
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
            },
            onError: (message) => cbs.current.onError?.(message),
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
        setRole,
        kick,
        notifySaved,
    };
}
