import React, { useEffect, useState } from 'react';
import { mapHistory, pinVersion, restoreVersion } from './api';
import Modal from '../ui/Modal';

const REASONS = {
    save: 'Overwritten',
    destructive: 'Most of it removed',
    pre_delete: 'Before it was deleted',
    pre_restore: 'Before a restore',
    manual: 'Kept on purpose',
};

const ago = (secs) => {
    if (!secs) return '';
    const mins = Math.round(Date.now() / 60000 - secs / 60);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}min ago`;
    const hours = Math.round(mins / 60);

    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export default function History({
    name, team, canEdit, onClose, onRestored,
}) {
    const [state, setState] = useState({ versions: [], current: null, loading: true });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(null);
    const [confirming, setConfirming] = useState(null);

    const load = () => {
        setState((s) => ({ ...s, loading: true }));
        mapHistory(name, team)
            .then((d) => setState({ versions: d.versions ?? [], current: d.current ?? null, loading: false }))
            .catch((e) => { setError(String(e.message ?? e)); setState((s) => ({ ...s, loading: false })); });
    };

    useEffect(load, [name, team]);

    const act = (key, run) => {
        setBusy(key);
        setError('');
        run()
            .then((d) => { setConfirming(null); load(); return d; })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setBusy(null));
    };

    const restore = (v) => act(v.id, () => restoreVersion(name, team, v.id).then((d) => {
        onRestored?.(d);

        return d;
    }));

    const pin = () => act('pin', () => pinVersion(name, team));

    return (
        <Modal
            title={`History of ${name}.json`}
            subtitle={state.current ? `Now: ${state.current.parts} parts, version ${state.current.version}` : null}
            onClose={onClose}
            wide
            footer={(
                <>
                    <button type="button" className="btn" onClick={onClose}>Close</button>
                    {canEdit && (
                        <button type="button" className="btn btn-go" onClick={pin} disabled={busy === 'pin'}>
                            {busy === 'pin' ? 'Keeping…' : 'Keep this version'}
                        </button>
                    )}
                </>
            )}
        >
            {error && <div className="modal-error">{error}</div>}

            {state.loading && <p className="modal-text">Loading…</p>}

            {!state.loading && state.versions.length === 0 && (
                <p className="modal-text">
                    Nothing to go back to yet. A copy is kept whenever this map is about to be
                    overwritten by someone else, changed heavily, or deleted.
                </p>
            )}

            {state.versions.length > 0 && (
                <ul className="history">
                    {state.versions.map((v) => (
                        <li key={v.id} className={v.reason === 'manual' ? 'history-row pinned' : 'history-row'}>
                            <div className="history-main">
                                <span className="history-parts">{v.parts} parts</span>
                                <span className="history-why">{REASONS[v.reason] ?? v.reason}</span>
                            </div>
                            <div className="history-meta">
                                {v.by ?? 'Anonymous'} · {ago(v.at)} · {size(v.bytes)}
                            </div>
                            {canEdit && (
                                confirming === v.id ? (
                                    <div className="history-confirm">
                                        <button
                                            type="button"
                                            className="btn btn-danger"
                                            disabled={busy === v.id}
                                            onClick={() => restore(v)}
                                        >
                                            {busy === v.id ? 'Restoring…' : 'Replace the map'}
                                        </button>
                                        <button type="button" className="btn" onClick={() => setConfirming(null)}>
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button type="button" className="btn" onClick={() => setConfirming(v.id)}>
                                        Restore
                                    </button>
                                )
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}
