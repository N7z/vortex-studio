import React, { useCallback, useState } from 'react';
import { deleteMap, listMaps } from './api';
import useList from './useList';
import Pager from './Pager';

const when = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString();

const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export default function Maps({ onChanged }) {
    const list = useList(useCallback((p) => listMaps(p), []));
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);

    const remove = async (m) => {
        if (!confirm(`Delete "${m.name}"? This cannot be undone.`)) return;
        setBusy(m.id);
        setError(null);
        try {
            await deleteMap(m.id);
            list.reload();
            onChanged?.();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="panel">
            <header className="panel-head">
                <h2>Maps</h2>
                <input
                    className="search" placeholder="Search map name"
                    value={list.q} onChange={(e) => list.setQ(e.target.value)}
                />
            </header>

            {error && <p className="error">{error}</p>}

            <table className="grid">
                <thead>
                    <tr>
                        <th>Name</th><th>Owner</th><th className="num">Size</th>
                        <th>Last saved</th><th />
                    </tr>
                </thead>
                <tbody>
                    {list.rows.map((m) => (
                        <tr key={m.id}>
                            <td>{m.name}</td>
                            <td className="dim">
                                {m.owner ?? <span className="tag">Anonymous</span>}
                            </td>
                            <td className="num">{size(m.bytes)}</td>
                            <td className="dim">{when(m.updated_at)}</td>
                            <td className="row-actions">
                                <a className="button" href={`/?view=${m.id}`} target="_blank" rel="noreferrer">
                                    Open
                                </a>
                                <button className="danger" disabled={busy === m.id} onClick={() => remove(m)}>
                                    Delete
                                </button>
                            </td>
                        </tr>
                    ))}
                    {!list.rows.length && !list.loading && (
                        <tr><td colSpan="5" className="dim">No maps match.</td></tr>
                    )}
                </tbody>
            </table>

            <Pager
                page={list.page} lastPage={list.lastPage} total={list.total}
                noun="maps" onPage={list.setPage}
            />
        </section>
    );
}
