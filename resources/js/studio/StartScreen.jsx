import React, { useEffect, useMemo, useRef, useState } from 'react';
import { deleteMap, listMaps, listTrash, purgeTrashed, renameMap, restoreTrashed } from './api';
import { listBackups, readBackup, deleteBackup } from './backup';
import useDialogs from '../ui/useDialogs';
import History from './History';
import MoveMap from './MoveMap';
import UserMenu from './UserMenu';

const DISCLAIMER_KEY = 'studio_disclaimer_closed';

const readClosed = () => {
    try {
        return localStorage.getItem(DISCLAIMER_KEY) === '1';
    } catch {
        return false;
    }
};

const ago = (ms) => {
    if (!ms) return '';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}min ago`;
    const hours = Math.round(mins / 60);

    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export default function StartScreen({
    onOpen, onCreate, onUpload, onRestore, onPasteRoblox, openName, openTeam, joining, liveStatus, mobile,
    accountSeq, onAccountSeen, onAccountChange, claimed,
}) {
    const [mine, setMine] = useState([]);
    const [examples, setExamples] = useState([]);
    const [ttl, setTtl] = useState(24);
    const [account, setAccount] = useState(null);
    const [teams, setTeams] = useState([]);
    const [backups, setBackups] = useState(() => listBackups());
    const [trash, setTrash] = useState([]);
    const [trashDays, setTrashDays] = useState(30);
    const [history, setHistory] = useState(null);
    const [disclaimer, setDisclaimer] = useState(() => !readClosed());
    const [error, setError] = useState('');
    const [scope, setScope] = useState(null);
    const [query, setQuery] = useState('');
    const [moving, setMoving] = useState(null);
    const [menu, setMenu] = useState(null);
    const fileRef = useRef(null);
    const { dialogs, notice, confirm, ask } = useDialogs();

    const refreshTrash = () => listTrash()
        .then((d) => { setTrash(d.trash ?? []); setTrashDays(d.trash_days ?? 30); })
        .catch(() => setTrash([]));

    const refresh = () => {
        refreshTrash();

        return listMaps()
            .then((d) => {
                const rows = d.mine ?? [];
                setMine(rows);
                setExamples(d.examples ?? []);
                setTtl(d.ttl_hours ?? 24);
                setAccount(d.account ?? null);
                setTeams(d.teams ?? []);
                onAccountSeen?.(d.account ?? null, d.ttl_hours ?? 24);
                // Examples are the only useful thing to click with nothing of your own,
                // and they leave the way as soon as there is a first map.
                setScope((s) => s ?? (rows.length ? 'personal' : 'examples'));
            })
            .catch((e) => setError(String(e.message ?? e)));
    };

    // Signing in from the toolbar changes which maps and teams there are.
    useEffect(() => { refresh(); }, [accountSeq]);

    const team = scope?.startsWith('team:') ? teams.find((t) => `team:${t.id}` === scope) : null;
    const teamId = team?.id ?? null;

    const create = async () => {
        const name = await ask({
            title: team ? `New map in ${team.name}` : 'New map',
            label: 'Map name',
            placeholder: 'my-level',
            validate: (v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v)
                ? '' : 'Use only letters, digits, - and _ (up to 64 characters).'),
            confirmLabel: 'Create',
        });
        if (name) onCreate(name, teamId);
    };

    const restore = (name) => {
        const parts = readBackup(name);
        if (!parts) {
            notice({
                title: 'That copy could not be read',
                body: `The copy of ${name}.json stored in this browser is unreadable, so it cannot be restored.`,
            });

            return;
        }
        onRestore(name, parts);
    };

    const forget = async (name) => {
        const yes = await confirm({
            title: `Delete the local copy of ${name}.json?`,
            body: 'Only the copy kept in this browser goes. Whatever is saved in the cloud is untouched.',
            confirmLabel: 'Delete copy',
            danger: true,
        });
        if (!yes) return;
        deleteBackup(name);
        setBackups(listBackups());
    };

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const parts = JSON.parse(await file.text());
            if (!Array.isArray(parts) || parts.some((p) => typeof p !== 'object' || p === null)) {
                throw new Error('not a map: expected a JSON array of parts');
            }
            const name = file.name
                .replace(/\.json$/i, '')
                .replace(/[^A-Za-z0-9_-]/g, '-')
                .slice(0, 64) || 'uploaded';
            onUpload(name, parts);
        } catch (err) {
            notice({ title: 'That file could not be read', body: String(err.message ?? err) });
        }
    };

    const personal = useMemo(() => mine.filter((m) => !m.team_id), [mine]);

    const scopes = useMemo(() => [
        { id: 'personal', label: 'Your maps', count: personal.length },
        ...teams.map((t) => ({
            id: `team:${t.id}`,
            label: t.name,
            count: mine.filter((m) => m.team_id === t.id).length,
        })),
        { id: 'examples', label: 'Examples', count: examples.length },
        { id: 'device', label: 'On this device', count: backups.length },
        ...(trash.length ? [{ id: 'trash', label: 'Trash', count: trash.length }] : []),
    ], [personal, teams, mine, examples, backups, trash]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const match = (n) => !q || n.toLowerCase().includes(q);
        if (scope === 'examples') return examples.filter((m) => match(m.title ?? m.name));
        if (scope === 'device') return backups.filter((b) => match(b.name));
        if (scope === 'trash') return trash.filter((m) => match(m.name));
        if (team) return mine.filter((m) => m.team_id === team.id && match(m.name));

        return personal.filter((m) => match(m.name));
    }, [scope, query, examples, backups, trash, mine, personal, team]);

    // Examples are read-only fixtures, and a device backup is not a stored map.
    const canManage = scope !== 'examples' && scope !== 'device' && scope !== 'trash'
        && (scope === 'personal' || team?.role !== 'viewer');

    const rename = async (m) => {
        setMenu(null);
        const to = await ask({
            title: `Rename ${m.name}`,
            label: 'New name',
            value: m.name,
            validate: (v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v)
                ? '' : 'Use only letters, digits, - and _ (up to 64 characters).'),
            confirmLabel: 'Rename',
        });
        if (!to || to === m.name) return;
        try {
            await renameMap(m.name, m.team_id ?? null, to);
            refresh();
        } catch (e) {
            notice({ title: 'That map could not be renamed', body: String(e.message ?? e) });
        }
    };

    const remove = async (m) => {
        setMenu(null);
        const yes = await confirm({
            title: `Delete ${m.name}.json?`,
            body: team
                ? 'It goes for everyone in this team, and cannot be undone.'
                : 'This cannot be undone. Any copy kept in this browser stays.',
            confirmLabel: 'Delete map',
            danger: true,
        });
        if (!yes) return;
        try {
            await deleteMap(m.name, m.team_id ?? null);
            refresh();
        } catch (e) {
            notice({ title: 'That map could not be deleted', body: String(e.message ?? e) });
        }
    };

    const undelete = async (m) => {
        try {
            const d = await restoreTrashed(m.id);
            refresh();
            if (d.name !== m.name) {
                notice({
                    title: `Restored as ${d.name}.json`,
                    body: `A map called ${m.name} was created while this one was in the trash, so the`
                        + ' one coming back was given a free name.',
                });
            }
        } catch (e) {
            notice({ title: 'That map could not be restored', body: String(e.message ?? e) });
        }
    };

    const shred = async (m) => {
        const yes = await confirm({
            title: `Delete ${m.name}.json for good?`,
            body: 'The map and every version kept of it go. This one really cannot be undone.',
            confirmLabel: 'Delete for good',
            danger: true,
        });
        if (!yes) return;
        try {
            await purgeTrashed(m.id);
            refresh();
        } catch (e) {
            notice({ title: 'That map could not be deleted', body: String(e.message ?? e) });
        }
    };

    const canCreate = scope === 'personal' || (team && team.role !== 'viewer');
    const canMove = !!account && (scope === 'personal'
        ? teams.some((t) => t.role !== 'viewer')
        : team?.role === 'owner');

    const openRow = (m) => {
        if (scope === 'trash') return undelete(m);
        if (scope === 'device') return restore(m.name);
        if (scope === 'examples') return onOpen(m.name, null);

        return onOpen(m.name, teamId);
    };

    const nothingHere = {
        personal: 'No maps of your own yet.',
        examples: 'No examples are installed.',
        device: 'Nothing has been saved from this browser yet.',
        trash: 'The trash is empty.',
    }[scope] ?? (team?.role === 'viewer'
        ? 'This team has no maps you can open.'
        : 'This team has no maps yet.');

    return (
        <div className="start">
            {dialogs}
            {history && (
                <History
                    name={history.name}
                    team={history.team_id ?? null}
                    canEdit={history.canEdit}
                    onClose={() => setHistory(null)}
                    onRestored={() => refresh()}
                />
            )}
            {moving && (
                <MoveMap
                    map={moving}
                    teams={teams}
                    onClose={() => setMoving(null)}
                    onDone={() => { setMoving(null); refresh(); }}
                />
            )}

            <header className="start-top">
                <h1>Paulin Studio</h1>
                {mobile && (
                    <UserMenu
                        account={account}
                        ttl={ttl}
                        claimed={claimed}
                        onChange={onAccountChange}
                    />
                )}
            </header>

            {joining && (
                <div className="join-row joining">
                    Joining session <b>{joining}</b>
                    {liveStatus === 'reconnecting' ? ', reconnecting...' : '...'}
                </div>
            )}
            {error && <div className="start-error">{error}</div>}

            <div className={mobile ? 'start-body mobile' : 'start-body'}>
                <nav className="scopes">
                    {scopes.map((s) => (
                        <button
                            type="button"
                            key={s.id}
                            className={scope === s.id ? 'scope on' : 'scope'}
                            onClick={() => { setScope(s.id); setQuery(''); }}
                        >
                            <span className="scope-label">{s.label}</span>
                            <span className="scope-count">{s.count}</span>
                        </button>
                    ))}
                </nav>

                <main className="scope-main">
                    <>
                            <div className="scope-bar">
                                {canCreate && (
                                    <button type="button" className="btn btn-go" onClick={create}>New map</button>
                                )}
                                {scope === 'personal' && (
                                    <>
                                        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                                            Upload Vortex Map
                                        </button>
                                        {!mobile && (
                                            <button type="button" className="btn" onClick={onPasteRoblox}>
                                                Import Roblox Map
                                            </button>
                                        )}
                                    </>
                                )}
                                {rows.length > 6 && (
                                    <input
                                        className="scope-search"
                                        placeholder="Search"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                    />
                                )}
                            </div>

                            {scope === 'personal' && !account && personal.length > 0 && (
                                <p className="scope-note">Kept {ttl}h after each save. Sign in to keep them.</p>
                            )}
                            {scope === 'trash' && (
                                <p className="scope-note">
                                    Deleted maps stay here for {trashDays} days. Open one to put it back.
                                </p>
                            )}

                            {rows.length === 0 ? (
                                <p className="scope-note">{query ? 'Nothing matches that.' : nothingHere}</p>
                            ) : (
                                <div className="cards">
                                    {rows.map((m) => (
                                        <div className="card" key={m.id ?? m.name}>
                                            <button type="button" className="card-open" onClick={() => openRow(m)}>
                                                <span className="card-shot">
                                                    {m.thumb
                                                        ? <img src={m.thumb} alt="" loading="lazy" />
                                                        : <span className="card-blank">{m.name.slice(0, 2)}</span>}
                                                </span>
                                                <span className="card-name">{m.title ?? m.name}</span>
                                                <span className="card-when">
                                                    {scope === 'trash'
                                                        ? `Deleted ${ago(m.deleted * 1000)}`
                                                        : scope === 'device'
                                                            ? ago(m.savedAt)
                                                            : ago(m.modified * 1000)}
                                                </span>
                                            </button>
                                            {m.name === openName && scope !== 'device' && teamId === openTeam && (
                                                <span className="card-tag">open</span>
                                            )}
                                            {scope === 'device' && (
                                                <button
                                                    type="button"
                                                    className="card-x"
                                                    title="Delete this local copy"
                                                    onClick={() => forget(m.name)}
                                                >
                                                    ×
                                                </button>
                                            )}
                                            {scope === 'trash' && (
                                                <button
                                                    type="button"
                                                    className="card-x"
                                                    title="Delete for good"
                                                    onClick={() => shred(m)}
                                                >
                                                    ×
                                                </button>
                                            )}
                                            {canManage && (
                                                <div className="card-menu">
                                                    <button
                                                        type="button"
                                                        className="card-dots"
                                                        title="More"
                                                        onClick={() => setMenu(menu === m.name ? null : m.name)}
                                                    >
                                                        ⋯
                                                    </button>
                                                    {menu === m.name && (
                                                        <>
                                                            <div className="menu-shade" onClick={() => setMenu(null)} />
                                                            <div className="menu-pop">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setMenu(null);
                                                                        setHistory({
                                                                            ...m,
                                                                            canEdit: scope === 'personal'
                                                                                || team?.role !== 'viewer',
                                                                        });
                                                                    }}
                                                                >
                                                                    History
                                                                </button>
                                                                <button type="button" onClick={() => rename(m)}>
                                                                    Rename
                                                                </button>
                                                                {canMove && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { setMenu(null); setMoving(m); }}
                                                                    >
                                                                        Move
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    className="danger"
                                                                    onClick={() => remove(m)}
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                    </>
                </main>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={onFile}
            />

            {disclaimer && (
                <div className="start-footer">
                    <button
                        className="start-footer-close"
                        title="Hide this"
                        onClick={() => {
                            setDisclaimer(false);
                            try {
                                localStorage.setItem(DISCLAIMER_KEY, '1');
                            } catch {
                                // Closing it for this visit is still worth doing.
                            }
                        }}
                    >
                        ×
                    </button>
                    <strong>This is NOT affiliated with https://playvortex.io.</strong> Paulin Studio is
                    an independent fan-made map editor that works right in your browser. You never
                    have to log in, create an account, or download anything: it simply edits map
                    .json files. An account is offered only so your maps outlive this browser.
                </div>
            )}
        </div>
    );
}
