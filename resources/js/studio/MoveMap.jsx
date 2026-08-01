import React, { useState } from 'react';
import { moveMap } from './api';
import Modal from '../ui/Modal';

export default function MoveMap({
    map, teams, onClose, onDone,
}) {
    const from = map.team_id ?? null;
    const options = [
        { id: null, label: 'My maps' },
        ...teams.filter((t) => t.role !== 'viewer').map((t) => ({ id: t.id, label: t.name })),
    ].filter((o) => o.id !== from);

    const [to, setTo] = useState(options[0]?.id ?? null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = () => {
        setBusy(true);
        setError('');
        moveMap(map.name, from, to)
            .then(onDone)
            .catch((e) => { setError(String(e.message ?? e)); setBusy(false); });
    };

    return (
        <Modal
            title={`Move ${map.name}.json`}
            subtitle="The map itself is untouched. Only who can reach it changes."
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className="btn btn-go" onClick={submit} disabled={busy || !options.length}>
                        {busy ? 'Moving…' : 'Move'}
                    </button>
                </>
            )}
        >
            {error && <div className="modal-error">{error}</div>}
            {options.length === 0 ? (
                <p className="modal-text">There is nowhere else to put this map.</p>
            ) : (
                <label className="field">
                    <span>Move to</span>
                    <select value={to ?? ''} onChange={(e) => setTo(e.target.value === '' ? null : Number(e.target.value))}>
                        {options.map((o) => (
                            <option key={o.id ?? 'personal'} value={o.id ?? ''}>{o.label}</option>
                        ))}
                    </select>
                </label>
            )}
        </Modal>
    );
}
