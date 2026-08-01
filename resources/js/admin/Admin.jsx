import React, { useCallback, useEffect, useState } from 'react';
import { overview } from './api';
import Chart from './Chart';
import Users from './Users';
import Maps from './Maps';
import Audit from './Audit';

const BLUE = '#3987e5';
const ORANGE = '#d95926';

const TABS = [['overview', 'Overview'], ['users', 'Users'], ['maps', 'Maps'], ['audit', 'Activity']];

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());

const ago = (secs) => {
    if (secs == null) return 'never';
    const m = Math.round((Date.now() / 1000 - secs) / 60);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
};

function Tile({ label, value, note }) {
    return (
        <div className="tile">
            <div className="tile-label">{label}</div>
            <div className="tile-value">{value}</div>
            {note && <div className="tile-note">{note}</div>}
        </div>
    );
}

export default function Admin() {
    const [tab, setTab] = useState('overview');
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(() => {
        overview().then(setData).catch((e) => setError(e.message));
    }, []);

    useEffect(load, [load]);

    if (error) return <div className="admin"><p className="error">{error}</p></div>;
    if (!data) return <div className="admin"><p className="dim">Loading…</p></div>;

    const t = data.totals;
    const anonShare = t.maps ? Math.round((t.maps_anon / t.maps) * 100) : 0;

    return (
        <div className="admin">
            <header className="admin-head">
                <h1>Studio admin</h1>
                <nav>
                    {TABS.map(([id, label]) => (
                        <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                            {label}
                        </button>
                    ))}
                </nav>
                <a className="button" href="/">Back to studio</a>
            </header>

            {tab === 'overview' && (
                <>
                    <div className="tiles">
                        <Tile label="Accounts" value={compact(t.users)} />
                        <Tile label="Maps" value={compact(t.maps)} note={`${anonShare}% anonymous`} />
                        <Tile label="Parts placed" value={compact(t.parts)} />
                        <Tile label="Last save" value={ago(t.last_save)} />
                    </div>

                    <div className="charts">
                        <Chart
                            title="New accounts" subtitle="per day, last 90 days" kind="bar"
                            data={data.signups} series={[{ key: 'accounts', label: 'Accounts', color: BLUE }]}
                        />
                        <Chart
                            title="Maps created" subtitle="per day, last 90 days" kind="bar"
                            data={data.created}
                            series={[
                                { key: 'account', label: 'Signed in', color: BLUE },
                                { key: 'anon', label: 'Anonymous', color: ORANGE },
                            ]}
                        />
                        <Chart
                            title="Totals" subtitle="recorded once a day"
                            data={data.history}
                            series={[
                                { key: 'users', label: 'Accounts', color: BLUE },
                                { key: 'maps', label: 'Maps', color: ORANGE },
                            ]}
                        />
                        <Chart
                            title="Parts stored" subtitle="recorded once a day"
                            data={data.history} series={[{ key: 'parts', label: 'Parts', color: BLUE }]}
                        />
                    </div>
                </>
            )}

            {tab === 'users' && <Users me={{ id: data.me }} onChanged={load} />}
            {tab === 'maps' && <Maps onChanged={load} />}
            {tab === 'audit' && <Audit />}
        </div>
    );
}
