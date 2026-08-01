import React, { useCallback } from 'react';
import { listAudit } from './api';
import useList from './useList';
import Pager from './Pager';

const when = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString();

const describe = (meta) => {
    if (!meta) return '';
    try {
        return Object.entries(JSON.parse(meta))
            .map(([k, v]) => `${k}: ${v ?? '—'}`)
            .join(', ');
    } catch {
        return meta;
    }
};

export default function Audit() {
    const list = useList(useCallback((p) => listAudit(p), []));

    return (
        <section className="panel">
            <header className="panel-head">
                <h2>Activity</h2>
                <input
                    className="search" placeholder="Search action, who, or details"
                    value={list.q} onChange={(e) => list.setQ(e.target.value)}
                />
            </header>

            {list.error && <p className="error">{list.error}</p>}

            <table className="grid">
                <thead>
                    <tr>
                        <th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th>
                    </tr>
                </thead>
                <tbody>
                    {list.rows.map((r) => (
                        <tr key={r.id}>
                            <td className="dim">{when(r.created_at)}</td>
                            <td>{r.who ?? <span className="tag">Anonymous</span>}</td>
                            <td><code>{r.action}</code></td>
                            <td className="dim">{describe(r.meta)}</td>
                            <td className="dim">{r.ip}</td>
                        </tr>
                    ))}
                    {!list.rows.length && !list.loading && (
                        <tr><td colSpan="5" className="dim">Nothing recorded yet.</td></tr>
                    )}
                </tbody>
            </table>

            <Pager
                page={list.page} lastPage={list.lastPage} total={list.total}
                noun="events" onPage={list.setPage}
            />
        </section>
    );
}
