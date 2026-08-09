import React, { useCallback, useState } from 'react';
import { deleteUser, listUsers, setBanned } from './api';
import useList from './useList';
import useDialogs from '../ui/useDialogs';
import Pager from './Pager';

const date = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString();

export default function Users({ me, onChanged }) {
    const list = useList(useCallback((p) => listUsers(p), []));
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const { dialogs, confirm } = useDialogs();

    const act = async (id, fn) => {
        setBusy(id);
        setError(null);
        try {
            await fn();
            list.reload();
            onChanged?.();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    const ban = (u) => act(u.id, () => setBanned(u.id, !u.banned_at));

    const remove = async (u) => {
        const maps = u.maps ? ` and ${u.maps} map${u.maps === 1 ? '' : 's'}` : '';
        const yes = await confirm({
            title: `Delete ${u.name}?`,
            body: `The account ${u.email}${maps} will be removed for good. This cannot be undone.`,
            confirmLabel: 'Delete account',
            danger: true,
        });
        if (yes) act(u.id, () => deleteUser(u.id));
    };

    return (
        <section className="panel">
            {dialogs}
            <header className="panel-head">
                <h2>Users</h2>
                <input
                    className="search" placeholder="Search name or email"
                    value={list.q} onChange={(e) => list.setQ(e.target.value)}
                />
            </header>

            {error && <p className="error">{error}</p>}

            <table className="grid">
                <thead>
                    <tr>
                        <th>Name</th><th>Email</th><th className="num">Maps</th>
                        <th>Joined</th><th>Status</th><th />
                    </tr>
                </thead>
                <tbody>
                    {list.rows.map((u) => (
                        <tr key={u.id} className={u.banned_at ? 'is-banned' : undefined}>
                            <td>{u.name}</td>
                            <td className="dim">{u.email}</td>
                            <td className="num">{u.maps}</td>
                            <td className="dim">{date(u.created_at)}</td>
                            <td>
                                {u.is_admin ? <span className="tag tag-admin">Admin</span> : null}
                                {u.banned_at ? <span className="tag tag-banned">Banned</span> : null}
                            </td>
                            <td className="row-actions">
                                {u.id === me?.id ? <span className="dim">You</span> : (
                                    <>
                                        <button disabled={busy === u.id} onClick={() => ban(u)}>
                                            {u.banned_at ? 'Unban' : 'Ban'}
                                        </button>
                                        <button
                                            className="danger" disabled={busy === u.id}
                                            onClick={() => remove(u)}
                                        >
                                            Delete
                                        </button>
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                    {!list.rows.length && !list.loading && (
                        <tr><td colSpan="6" className="dim">No accounts match.</td></tr>
                    )}
                </tbody>
            </table>

            <Pager
                page={list.page} lastPage={list.lastPage} total={list.total}
                noun="accounts" onPage={list.setPage}
            />
        </section>
    );
}
