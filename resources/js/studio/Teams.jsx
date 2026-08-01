import React, { useEffect, useState } from 'react';
import {
    addTeamMember, createTeam, deleteTeam, removeMember, setMemberRole, teamMembers,
} from './api';

function Members({ team, me, onChanged }) {
    const [rows, setRows] = useState(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('editor');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = () => teamMembers(team.id)
        .then((d) => setRows(d.members ?? []))
        .catch((e) => setError(String(e.message ?? e)));

    useEffect(() => { load(); }, [team.id]);

    const run = (p) => {
        setBusy(true);
        setError('');
        p.then(() => { load(); onChanged?.(); })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setBusy(false));
    };

    const owner = team.role === 'owner';

    return (
        <div className="team-members">
            {error && <div className="team-error">{error}</div>}
            {rows === null ? <div className="ttl-note">Loading…</div> : rows.map((m) => (
                <div className="team-member" key={m.id}>
                    <span>{m.name}</span>
                    {owner && m.role !== 'owner' ? (
                        <select
                            value={m.role}
                            disabled={busy}
                            onChange={(e) => run(setMemberRole(team.id, m.id, e.target.value))}
                        >
                            <option value="editor">can edit</option>
                            <option value="viewer">can view</option>
                        </select>
                    ) : (
                        <span className="ttl-note">{m.role === 'owner' ? 'owner' : m.role}</span>
                    )}
                    {(owner ? m.role !== 'owner' : m.id === me) && (
                        <button
                            className="forget"
                            disabled={busy}
                            title={m.id === me ? 'Leave this team' : 'Remove from the team'}
                            onClick={() => {
                                const q = m.id === me
                                    ? `Leave ${team.name}?`
                                    : `Remove ${m.name} from ${team.name}?`;
                                if (confirm(q)) run(removeMember(team.id, m.id));
                            }}
                        >
                            ×
                        </button>
                    )}
                </div>
            ))}

            {owner && (
                <button
                    type="button"
                    className="team-delete"
                    disabled={busy}
                    onClick={() => {
                        const q = `Delete ${team.name}? Its maps move to your own maps; nothing is deleted.`;
                        if (confirm(q)) run(deleteTeam(team.id));
                    }}
                >
                    Delete this team
                </button>
            )}

            {owner && (
                <form
                    className="team-add"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!email.trim()) return;
                        run(addTeamMember(team.id, email.trim(), role).then(() => setEmail('')));
                    }}
                >
                    <input
                        type="email"
                        placeholder="their account email"
                        value={email}
                        disabled={busy}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}>
                        <option value="editor">can edit</option>
                        <option value="viewer">can view</option>
                    </select>
                    <button type="submit" disabled={busy}>Add</button>
                </form>
            )}
        </div>
    );
}

export default function Teams({ teams, me, onChanged }) {
    const [open, setOpen] = useState(null);
    const [error, setError] = useState('');

    const create = () => {
        const name = prompt('Team name:');
        if (!name?.trim()) return;
        createTeam(name.trim())
            .then(() => { setError(''); onChanged?.(); })
            .catch((e) => setError(String(e.message ?? e)));
    };

    return (
        <>
            <h2>
                Teams
                <span className="ttl-note">maps a whole team can edit, at any time</span>
            </h2>
            {error && <div className="team-error">{error}</div>}
            {teams.map((t) => (
                <div className="team-row" key={t.id}>
                    <a onClick={() => setOpen(open === t.id ? null : t.id)}>
                        {t.name}
                        <span className="ttl-note">{t.role === 'owner' ? 'you own this' : `you ${t.role === 'viewer' ? 'can view' : 'can edit'}`}</span>
                    </a>
                    {open === t.id && <Members team={t} me={me} onChanged={onChanged} />}
                </div>
            ))}
            <a onClick={create}>Create a team</a>
        </>
    );
}
