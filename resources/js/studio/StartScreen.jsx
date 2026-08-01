import React, { useEffect, useRef, useState } from 'react';
import { listMaps } from './api';
import { listBackups, readBackup, deleteBackup } from './backup';
import Account from './Account';
import Teams from './Teams';

const DISCLAIMER_KEY = 'studio_disclaimer_closed';

const readClosed = () => {
    try {
        return localStorage.getItem(DISCLAIMER_KEY) === '1';
    } catch {
        return false;
    }
};

const ago = (ms) => {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}min ago`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export default function StartScreen({
    onOpen, onCreate, onUpload, onRestore, onPasteRoblox, openName, openTeam, joining, liveStatus, mobile,
}) {
    const [mine, setMine] = useState([]);
    const [examples, setExamples] = useState([]);
    const [ttl, setTtl] = useState(24);
    const [account, setAccount] = useState(null);
    const [teams, setTeams] = useState([]);
    const [claimed, setClaimed] = useState(0);
    const [backups, setBackups] = useState(() => listBackups());
    const [disclaimer, setDisclaimer] = useState(() => !readClosed());
    const [error, setError] = useState('');
    const fileRef = useRef(null);

    const personal = mine.filter((m) => !m.team_id);

    const restore = (name) => {
        const parts = readBackup(name);
        if (!parts) {
            alert(`The local copy of ${name}.json could not be read.`);
            return;
        }
        onRestore(name, parts);
    };

    const forget = (name) => {
        if (!confirm(`Delete the copy of ${name}.json stored on this device?`)) return;
        deleteBackup(name);
        setBackups(listBackups());
    };

    const refresh = () =>
        listMaps()
            .then((d) => {
                setMine(d.mine ?? []);
                setExamples(d.examples ?? []);
                setTtl(d.ttl_hours ?? 24);
                setAccount(d.account ?? null);
                setTeams(d.teams ?? []);
            })
            .catch((e) => setError(String(e.message ?? e)));

    useEffect(() => { refresh(); }, []);

    const accountChanged = (next, moved) => {
        setAccount(next);
        setClaimed(moved);
        refresh();
    };

    const create = (teamId = null) => {
        const name = prompt('New map name (letters, digits, - and _):');
        if (!name) return;
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) { alert('Invalid name.'); return; }
        onCreate(name, teamId);
    };

    const pickFile = () => fileRef.current?.click();

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
            alert(`Could not read that file: ${err.message}`);
        }
    };

    return (
        <div className="start">
            <div className="account-corner">
                <Account account={account} ttl={ttl} onChange={accountChanged} />
                {claimed > 0 && (
                    <div className="account-claimed">
                        {claimed} map{claimed === 1 ? '' : 's'} from this browser moved to your account.
                    </div>
                )}
            </div>
            <div className="start-scroll">
                <h1>Paulin Studio</h1>
                <a onClick={() => create(null)}>Create new project</a>
                <a onClick={pickFile}>Upload a map (.json)</a>
                {!mobile && <a onClick={onPasteRoblox}>Import a Roblox place</a>}
                <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={onFile}
                />
                {joining && (
                    <div className="join-row joining">
                        Joining session <b>{joining}</b>
                        {liveStatus === 'reconnecting' ? ', reconnecting...' : '...'}
                    </div>
                )}
                {error && <div style={{ color: '#e05252' }}>{error}</div>}
                {personal.length > 0 && (
                    <>
                        <h2>
                            Your maps in the cloud
                            <span className="ttl-note">
                                {account ? 'kept with your account' : `kept ${ttl}h after each save`}
                            </span>
                        </h2>
                        {personal.map((m) => (
                            <a key={m.name} onClick={() => onOpen(m.name, null)}>
                                {m.name}.json
                                {m.name === openName && openTeam == null
                                    && <span className="ttl-note">open</span>}
                            </a>
                        ))}
                    </>
                )}
                {teams.map((t) => {
                    const rows = mine.filter((m) => m.team_id === t.id);
                    if (!rows.length && t.role === 'viewer') return null;

                    return (
                        <React.Fragment key={t.id}>
                            <h2>{t.name}<span className="ttl-note">team maps</span></h2>
                            {t.role !== 'viewer' && (
                                <a onClick={() => create(t.id)}>New map in {t.name}</a>
                            )}
                            {rows.map((m) => (
                                <a key={m.name} onClick={() => onOpen(m.name, t.id)}>
                                    {m.name}.json
                                    {m.name === openName && openTeam === t.id
                                        && <span className="ttl-note">open</span>}
                                </a>
                            ))}
                        </React.Fragment>
                    );
                })}
                {account && (
                    <Teams teams={teams} me={account.id} onChanged={refresh} />
                )}
                {backups.length > 0 && (
                    <>
                        <h2>On this device <span className="ttl-note">a copy of every save, kept in this browser</span></h2>
                        {backups.map((b) => (
                            <div className="backup-row" key={b.name}>
                                <a onClick={() => restore(b.name)}>{b.name}.json</a>
                                <span className="ttl-note">{ago(b.savedAt)}</span>
                                <button
                                    className="forget"
                                    title="Delete this local copy"
                                    onClick={() => forget(b.name)}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </>
                )}
                <h2>Example maps</h2>
                {examples.map((m) => (
                    <a key={m.name} onClick={() => onOpen(m.name)}>{m.name}.json</a>
                ))}
            </div>
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
