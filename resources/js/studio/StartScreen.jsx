import React, { useEffect, useRef, useState } from 'react';
import { listMaps } from './api';

export default function StartScreen({ onOpen, onCreate, onUpload }) {
    const [mine, setMine] = useState([]);
    const [examples, setExamples] = useState([]);
    const [ttl, setTtl] = useState(24);
    const [error, setError] = useState('');
    const fileRef = useRef(null);

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
                        <h2>Your maps <span className="ttl-note">kept for {ttl}h, download what you want to keep</span></h2>
                        {mine.map((m) => (
                            <a key={m.name} onClick={() => onOpen(m.name)}>{m.name}.json</a>
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
