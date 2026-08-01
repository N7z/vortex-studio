import React, { useEffect, useState } from 'react';
import {
    addTeamMember, createTeam, deleteTeam, removeMember, setMemberRole, teamMembers,
} from './api';
import Modal, { Confirm } from '../ui/Modal';

const AVATAR_COLORS = ['#5b8dd6', '#c2606a', '#6ea86e', '#c08a3e', '#8f6ec4', '#3e9ba8'];

const initials = (name) => (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

const colorFor = (id) => AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length];

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };

function Avatar({ member }) {
    return (
        <span className="avatar" style={{ background: colorFor(member.id) }}>{initials(member.name)}</span>
    );
}

function CreateTeam({ onClose, onDone }) {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = (e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError('');
        createTeam(name.trim())
            .then(() => { onDone(); onClose(); })
            .catch((err) => { setError(String(err.message ?? err)); setBusy(false); });
    };

    return (
        <Modal
            title="New team"
            subtitle="Everyone you add can open and save the team's maps, whenever they like."
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" form="team-create" className="btn btn-go" disabled={busy || !name.trim()}>
                        {busy ? 'Creating…' : 'Create team'}
                    </button>
                </>
            )}
        >
            <form id="team-create" onSubmit={submit}>
                {error && <div className="modal-error">{error}</div>}
                <label className="field">
                    <span>Team name</span>
                    <input
                        value={name}
                        maxLength={64}
                        placeholder="Level design"
                        onChange={(e) => setName(e.target.value)}
                    />
                </label>
            </form>
        </Modal>
    );
}

function ManageTeam({ team, me, onClose, onChanged }) {
    const [rows, setRows] = useState(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('editor');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(null);

    const owner = team.role === 'owner';

    const load = () => teamMembers(team.id)
        .then((d) => setRows(d.members ?? []))
        .catch((e) => setError(String(e.message ?? e)));

    useEffect(() => { load(); }, [team.id]);

    // `after` runs only when the request succeeded, so a failure leaves the modal
    // open with its message rather than closing over the top of it.
    const run = (p, { after, reload = true } = {}) => {
        setBusy(true);
        setError('');

        return p
            .then((r) => {
                if (reload) load();
                onChanged?.();
                after?.(r);
            })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setBusy(false));
    };

    const add = (e) => {
        e.preventDefault();
        if (!email.trim() || busy) return;
        run(addTeamMember(team.id, email.trim(), role), { after: () => setEmail('') });
    };

    return (
        <>
            <Modal
                wide
                title={team.name}
                subtitle={owner ? 'You own this team' : `You ${team.role === 'viewer' ? 'can view' : 'can edit'} its maps`}
                onClose={onClose}
                footer={owner && (
                    <button
                        type="button"
                        className="btn btn-danger-ghost"
                        disabled={busy}
                        onClick={() => setConfirm({
                            kind: 'team',
                            title: `Delete ${team.name}?`,
                            body: 'The team and its member list go. Its maps are kept and move into your own maps, so nothing is lost.',
                            label: 'Delete team',
                        })}
                    >
                        Delete team
                    </button>
                )}
            >
                {error && <div className="modal-error">{error}</div>}

                {owner && (
                    <form className="invite" onSubmit={add}>
                        <input
                            type="email"
                            placeholder="Add someone by account email"
                            value={email}
                            disabled={busy}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}>
                            <option value="editor">Can edit</option>
                            <option value="viewer">Can view</option>
                        </select>
                        <button type="submit" className="btn btn-go" disabled={busy || !email.trim()}>Add</button>
                    </form>
                )}

                <ul className="member-list">
                    {rows === null && <li className="member-empty">Loading…</li>}
                    {rows?.map((m) => (
                        <li className="member" key={m.id}>
                            <Avatar member={m} />
                            <div className="member-who">
                                <b>{m.name}{m.id === me && <span className="tag">you</span>}</b>
                                <span>{m.email}</span>
                            </div>
                            {owner && m.role !== 'owner' ? (
                                <select
                                    value={m.role}
                                    disabled={busy}
                                    onChange={(e) => run(setMemberRole(team.id, m.id, e.target.value))}
                                >
                                    <option value="editor">Can edit</option>
                                    <option value="viewer">Can view</option>
                                </select>
                            ) : (
                                <span className="member-role">{ROLE_LABEL[m.role] ?? m.role}</span>
                            )}
                            {(owner ? m.role !== 'owner' : m.id === me) && (
                                <button
                                    type="button"
                                    className="member-x"
                                    disabled={busy}
                                    title={m.id === me ? 'Leave this team' : 'Remove from team'}
                                    onClick={() => setConfirm({
                                        kind: 'member',
                                        id: m.id,
                                        title: m.id === me ? `Leave ${team.name}?` : `Remove ${m.name}?`,
                                        body: m.id === me
                                            ? 'You will lose access to this team\'s maps until someone adds you back.'
                                            : `${m.name} will lose access to this team's maps. Nothing they made is deleted.`,
                                        label: m.id === me ? 'Leave team' : 'Remove',
                                    })}
                                >
                                    ×
                                </button>
                            )}
                        </li>
                    ))}
                    {rows?.length === 0 && <li className="member-empty">Nobody here yet.</li>}
                </ul>
            </Modal>

            {confirm && (
                <Confirm
                    danger
                    busy={busy}
                    title={confirm.title}
                    body={confirm.body}
                    confirmLabel={confirm.label}
                    onClose={() => setConfirm(null)}
                    onConfirm={() => {
                        const done = () => { setConfirm(null); onClose(); };
                        if (confirm.kind === 'team') {
                            return run(deleteTeam(team.id), { after: done, reload: false });
                        }

                        // Leaving takes your own access with it, so the panel goes too.
                        return run(removeMember(team.id, confirm.id), {
                            after: () => (confirm.id === me ? done() : setConfirm(null)),
                            reload: confirm.id !== me,
                        });
                    }}
                />
            )}
        </>
    );
}

export default function Teams({ teams, me, onChanged }) {
    const [creating, setCreating] = useState(false);
    const [managing, setManaging] = useState(null);

    const open = teams.find((t) => t.id === managing) ?? null;

    return (
        <>
            <h2>
                Teams
                <span className="ttl-note">maps a whole team can edit, at any time</span>
            </h2>

            <div className="team-cards">
                {teams.map((t) => (
                    <button type="button" className="team-card" key={t.id} onClick={() => setManaging(t.id)}>
                        <span className="team-card-name">{t.name}</span>
                        <span className={`role-pill role-${t.role}`}>{ROLE_LABEL[t.role] ?? t.role}</span>
                    </button>
                ))}
                <button type="button" className="team-card team-card-new" onClick={() => setCreating(true)}>
                    <span className="team-card-plus">+</span>
                    New team
                </button>
            </div>

            {creating && <CreateTeam onClose={() => setCreating(false)} onDone={onChanged} />}
            {open && (
                <ManageTeam
                    team={open}
                    me={me}
                    onChanged={onChanged}
                    onClose={() => setManaging(null)}
                />
            )}
        </>
    );
}
