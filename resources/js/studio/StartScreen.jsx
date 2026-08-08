import React, { useEffect, useMemo, useRef, useState } from 'react';
import { deleteMap, listMaps, listTrash, purgeTrashed, renameMap, restoreTrashed } from './api';
import { listBackups, readBackup, deleteBackup } from './backup';
import useDialogs from '../ui/useDialogs';
import History from './History';
import MoveMap from './MoveMap';
import UserMenu from './UserMenu';
import Clothing from './clothing/Clothing';
import { fromProject, isProject } from './vortexProject';

const DISCLAIMER_KEY = 'studio_disclaimer_closed';
const EXAMPLES_GONE_KEY = 'studio_examples_removed_closed';

const readClosed = (key) => {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
};

const markClosed = (key) => {
    try {
        localStorage.setItem(key, '1');
    } catch {
        // Closing it for this visit is still worth doing.
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
    const [ttl, setTtl] = useState(24);
    const [account, setAccount] = useState(null);
    const [teams, setTeams] = useState([]);
    const [backups, setBackups] = useState(() => listBackups());
    const [trash, setTrash] = useState([]);
    const [trashDays, setTrashDays] = useState(30);
    const [history, setHistory] = useState(null);
    const [disclaimer, setDisclaimer] = useState(() => !readClosed(DISCLAIMER_KEY));
    const [error, setError] = useState('');
    const [scope, setScope] = useState(null);
    const [group, setGroup] = useState('');
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
                setMine(d.mine ?? []);
                setTtl(d.ttl_hours ?? 24);
                setAccount(d.account ?? null);
                setTeams(d.teams ?? []);
                onAccountSeen?.(d.account ?? null, d.ttl_hours ?? 24);
                setScope((s) => s ?? 'personal');
            })
            .catch((e) => setError(String(e.message ?? e)));
    };

    // Signing in from the toolbar changes which maps and teams there are.
    useEffect(() => { refresh(); }, [accountSeq]);

    // Once per browser: a whole section of the start screen is gone, and nobody can
    // guess why from the empty space it left. Marked seen as it opens, so dismissing
    // it any way at all is the last of it.
    useEffect(() => {
        if (readClosed(EXAMPLES_GONE_KEY)) return;
        markClosed(EXAMPLES_GONE_KEY);
        notice({
            title: 'The example maps are gone',
            body: 'Vortex maps are not allowed to be used outside the game itself, so the examples'
                + ' that used to ship with the editor have been removed at the developers\' request.'
                + ' Your own maps are untouched: make a new one, or upload a .json you already have.',
            confirmLabel: 'Got it',
        });
    }, []);

    const only = teams.length === 1 ? String(teams[0].id) : group;
    const team = scope === 'groups' && only ? teams.find((t) => String(t.id) === only) : null;
    const teamId = team?.id ?? null;

    const roleIn = (id) => teams.find((t) => t.id === id)?.role;

    useEffect(() => {
        if (account && scope === 'device') setScope('personal');
    }, [account, scope]);

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
            const doc = JSON.parse(await file.text());
            let parts = doc;
            let groups = null;
            if (isProject(doc)) {
                ({ parts, groups } = fromProject(doc));
            } else if (!Array.isArray(parts) || parts.some((p) => typeof p !== 'object' || p === null)) {
                throw new Error('not a map: expected a Vortex project or a JSON array of parts');
            }
            const name = file.name
                .replace(/\.json$/i, '')
                .replace(/[^A-Za-z0-9_-]/g, '-')
                .slice(0, 64) || 'uploaded';
            onUpload(name, parts, groups);
        } catch (err) {
            notice({ title: 'That file could not be read', body: String(err.message ?? err) });
        }
    };

    const personal = useMemo(() => mine.filter((m) => !m.team_id), [mine]);

    const sections = useMemo(() => [
        {
            title: 'Maps',
            items: [
                { id: 'personal', label: 'Your maps', count: personal.length },
                ...(teams.length
                    ? [{
                        id: 'groups',
                        label: 'Group maps',
                        count: mine.filter((m) => m.team_id).length,
                    }]
                    : []),
                ...(account ? [] : [{ id: 'device', label: 'On this device', count: backups.length }]),
                ...(trash.length ? [{ id: 'trash', label: 'Trash', count: trash.length }] : []),
            ],
        },
        { title: 'Create', items: [{ id: 'ugc', label: 'Clothing', count: '' }] },
    ], [personal, teams, mine, backups, trash, account]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const match = (n) => !q || n.toLowerCase().includes(q);
        if (scope === 'device') return backups.filter((b) => match(b.name));
        if (scope === 'trash') return trash.filter((m) => match(m.name));
        if (scope === 'groups') {
            return mine.filter((m) => m.team_id && (!team || m.team_id === team.id) && match(m.name));
        }

        return personal.filter((m) => match(m.name));
    }, [scope, query, backups, trash, mine, personal, team]);

    // A device backup is not a stored map, and a trashed one is not open to editing.
    const manageable = (m) => {
        if (scope === 'device' || scope === 'trash') return false;
        if (scope === 'groups') return roleIn(m.team_id) !== 'viewer';

        return true;
    };

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
    const movable = (m) => !!account && (scope === 'personal'
        ? teams.some((t) => t.role !== 'viewer')
        : roleIn(m.team_id) === 'owner');

    const openRow = (m) => {
        if (scope === 'trash') return undelete(m);
        if (scope === 'device') return restore(m.name);

        return onOpen(m.name, m.team_id ?? null);
    };

    const nothingHere = {
        personal: 'No maps of your own yet.',
        device: 'Nothing has been saved from this browser yet.',
        trash: 'The trash is empty.',
        groups: team?.role === 'viewer'
            ? 'This group has no maps you can open.'
            : 'No maps in your groups yet.',
    }[scope] ?? '';

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
                    {sections.map((sec) => (
                        <div className="scope-section" key={sec.title}>
                            {!mobile && <div className="scope-title">{sec.title}</div>}
                            {sec.items.map((s) => (
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
                        </div>
                    ))}
                </nav>

                <main className="scope-main">
                    {scope === 'ugc' ? <Clothing /> : (
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
                                {scope === 'groups' && teams.length > 1 && (
                                    <select
                                        className="scope-pick"
                                        value={group}
                                        onChange={(e) => setGroup(e.target.value)}
                                    >
                                        <option value="">All groups</option>
                                        {teams.map((t) => (
                                            <option key={t.id} value={String(t.id)}>{t.name}</option>
                                        ))}
                                    </select>
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
                                                <span className="card-name">{m.name}</span>
                                                <span className="card-when">
                                                    {scope === 'groups' && !team && (
                                                        <span className="card-group">
                                                            {teams.find((t) => t.id === m.team_id)?.name}
                                                        </span>
                                                    )}
                                                    {scope === 'trash'
                                                        ? `Deleted ${ago(m.deleted * 1000)}`
                                                        : scope === 'device'
                                                            ? ago(m.savedAt)
                                                            : ago(m.modified * 1000)}
                                                </span>
                                            </button>
                                            {m.name === openName && scope !== 'device'
                                                && (m.team_id ?? null) === openTeam && (
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
                                            {manageable(m) && (
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
                                                                                || roleIn(m.team_id) !== 'viewer',
                                                                        });
                                                                    }}
                                                                >
                                                                    History
                                                                </button>
                                                                <button type="button" onClick={() => rename(m)}>
                                                                    Rename
                                                                </button>
                                                                {movable(m) && (
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
                    )}
                </main>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={onFile}
            />

            <div className="start-credit">
                {`© ${new Date().getFullYear()} zPaulinBRz - Not affiliated with `}
                <a href="https://playvortex.io" target="_blank" rel="noreferrer">https://playvortex.io</a>
            </div>

            {disclaimer && (
                <div className="start-footer">
                    <button
                        className="start-footer-close"
                        title="Hide this"
                        onClick={() => { setDisclaimer(false); markClosed(DISCLAIMER_KEY); }}
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
