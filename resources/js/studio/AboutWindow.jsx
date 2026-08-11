import React, { useEffect, useMemo, useState } from 'react';
import useDraggable from './useDraggable';
import { loadAbout, loadContributors } from './api';
import { APP_VERSION, BUILD_INFO } from './version';

const n = (v) => (v ?? 0).toLocaleString();

function dur(s) {
    if (s == null) return null;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;

    return `${Math.floor(s)} s`;
}

function ago(ts) {
    if (!ts) return null;
    const s = Math.floor(Date.now() / 1000 - ts);

    return s < 60 ? 'just now' : `${dur(s)} ago`;
}

const full = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : undefined);

function initials(name) {
    const parts = name.split(/[\s_-]+/).filter(Boolean);

    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function hue(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;

    return h;
}

function Row({ label, value, hint }) {
    if (value == null || value === '') return null;

    return (
        <div className="stat-line" title={hint}>
            <span className="stat-key">{label}</span>
            <span className="stat-val">{value}</span>
        </div>
    );
}

function Face({ person }) {
    const [broken, setBroken] = useState(false);
    const tint = { background: `hsl(${hue(person.name)} 55% 42%)` };

    if (!person.avatar || broken) {
        return <span className="about-dot" style={tint}>{initials(person.name)}</span>;
    }

    return (
        <img
            className="about-dot about-face"
            src={person.avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={tint}
            onError={() => setBroken(true)}
        />
    );
}

function Person({ person, top }) {
    const body = (
        <>
            <Face person={person} />
            <span className="about-name" title={person.name}>{person.name}</span>
            <span className="about-bar">
                <i style={{ width: `${Math.max((person.commits / top) * 100, 6)}%` }} />
            </span>
            <span className="about-count">{n(person.commits)}</span>
        </>
    );
    const title = `${n(person.commits)} commits`;

    if (!person.url) return <div className="about-person" title={title}>{body}</div>;

    return (
        <a className="about-person" href={person.url} target="_blank" rel="noreferrer" title={title}>
            {body}
        </a>
    );
}

export default function AboutWindow({ onClose }) {
    const { style, onPointerDown } = useDraggable('about');
    const [server, setServer] = useState(null);
    const [people, setPeople] = useState(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        let live = true;
        loadAbout().then((about) => live && setServer({ ...about, at: Date.now() })).catch(() => {});
        loadContributors().then((list) => live && setPeople(list)).catch(() => live && setPeople([]));

        return () => { live = false; };
    }, []);

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);

        return () => clearInterval(t);
    }, []);

    const commitAt = useMemo(() => {
        const iso = BUILD_INFO.commitAt;

        return iso ? Math.floor(new Date(iso).getTime() / 1000) : null;
    }, []);

    const uptime = server?.deploy_uptime == null ? null : server.deploy_uptime + Math.floor((now - server.at) / 1000);
    const contributors = people?.length ? people : (BUILD_INFO.contributors ?? []);
    const top = contributors[0]?.commits ?? 1;
    const placed = style ? { ...style, transform: 'none' } : undefined;

    return (
        <div className="team-panel about-panel" style={placed}>
            <div className="team-head" onPointerDown={onPointerDown}>
                <span className="team-title">About</span>
                <button className="team-x" onClick={onClose} title="Close">×</button>
            </div>
            <div className="team-body">
                <h3 className="about-title">Paulin Studio</h3>
                <p className="about-version">
                    {BUILD_INFO.commit ? `Version ${APP_VERSION} · ${BUILD_INFO.commit}` : `Version ${APP_VERSION}`}
                </p>
                <p className="about-blurb">
                    An independent fan-made map editor that runs in your browser. Not
                    affiliated with <a href="https://playvortex.io" target="_blank" rel="noreferrer">playvortex.io</a>.
                </p>

                <Row label="Last update" value={ago(commitAt)} hint={full(commitAt)} />
                <Row label="Uptime" value={dur(uptime)} hint={full(server?.deployed_at)} />

                <div className="stat-group">
                    {contributors.length ? `Contributors (${contributors.length})` : 'Contributors'}
                </div>
                {!contributors.length ? (
                    <span className="team-hint">{people == null ? 'Loading...' : 'Not available.'}</span>
                ) : (
                    <div className="about-people">
                        {contributors.map((c) => <Person key={c.name} person={c} top={top} />)}
                    </div>
                )}
            </div>
        </div>
    );
}
