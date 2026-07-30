import React, { useEffect, useRef, useState } from 'react';
import { listMaps } from './api';
import { listBackups, readBackup, deleteBackup } from './backup';

const ago = (ms) => {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}min ago`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export default function StartScreen({ onOpen, onCreate, onUpload, onRestore }) {
    const [mine, setMine] = useState([]);
    const [examples, setExamples] = useState([]);
    const [ttl, setTtl] = useState(24);
    const [backups, setBackups] = useState(() => listBackups());
    const [error, setError] = useState('');
    const fileRef = useRef(null);

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

    useEffect(() => {
        listMaps()
            .then((d) => {
                setMine(d.mine ?? []);
                setExamples(d.examples ?? []);
                setTtl(d.ttl_hours ?? 24);
            })
            .catch((e) => setError(String(e.message ?? e)));
    }, []);

    const create = () => {
        const name = prompt('New map name (letters, digits, - and _):');
        if (!name) return;
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) { alert('Invalid name.'); return; }
        onCreate(name);
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
            <div className="start-scroll">
                <h1>Vortex Studio</h1>
                <a onClick={create}>Create new project</a>
                <a onClick={pickFile}>Upload a map (.json)</a>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={onFile}
                />
                {error && <div style={{ color: '#e05252' }}>{error}</div>}
                {mine.length > 0 && (
                    <>
                        <h2>Your maps in the cloud <span className="ttl-note">kept {ttl}h after each save</span></h2>
                        {mine.map((m) => (
                            <a key={m.name} onClick={() => onOpen(m.name)}>{m.name}.json</a>
                        ))}
                    </>
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
            <div className="start-footer">
                <strong>This is NOT affiliated with https://playvortex.io.</strong> Vortex Studio is
                an independent fan-made map editor that works right in your browser. We never ask
                you to log in, create an account, or download anything: it simply edits map
                .json files.
            </div>
        </div>
    );
}
