import React, { useCallback, useRef, useState } from 'react';
import Modal from './Modal';

/**
 * Promise-based replacements for alert/confirm/prompt, so a call site reads the
 * same way the blocking original did. Dismissing resolves false/null, never throws.
 */
export default function useDialogs() {
    const [open, setOpen] = useState(null);
    const resolve = useRef(null);

    const settle = useCallback((value) => {
        const done = resolve.current;
        resolve.current = null;
        setOpen(null);
        done?.(value);
    }, []);

    const show = useCallback((spec) => new Promise((res) => {
        // A dialog opened over another would strand the first one's caller.
        resolve.current?.(spec.kind === 'ask' ? null : false);
        resolve.current = res;
        setOpen(spec);
    }), []);

    const notice = useCallback((o) => show({ kind: 'notice', ...o }), [show]);
    const confirm = useCallback((o) => show({ kind: 'confirm', ...o }), [show]);
    const ask = useCallback((o) => show({ kind: 'ask', ...o }), [show]);

    const dialogs = open ? <Dialog spec={open} settle={settle} /> : null;

    return {
        dialogs, notice, confirm, ask,
    };
}

function Dialog({ spec, settle }) {
    const {
        kind, title, body, label, placeholder, value = '', multiline,
        confirmLabel, danger, validate,
    } = spec;
    const [text, setText] = useState(value);
    const [error, setError] = useState('');

    const cancelled = () => settle(kind === 'ask' ? null : false);

    const accept = (e) => {
        e?.preventDefault();
        if (kind !== 'ask') return settle(true);
        const bad = validate?.(text.trim());
        if (bad) return setError(bad);

        return settle(text.trim());
    };

    const ok = confirmLabel ?? (kind === 'notice' ? 'OK' : 'Confirm');

    return (
        <Modal
            title={title}
            onClose={cancelled}
            footer={(
                <>
                    {kind !== 'notice' && (
                        <button type="button" className="btn" onClick={cancelled}>Cancel</button>
                    )}
                    <button
                        type="button"
                        className={danger ? 'btn btn-danger' : 'btn btn-go'}
                        onClick={accept}
                        disabled={kind === 'ask' && !text.trim()}
                    >
                        {ok}
                    </button>
                </>
            )}
        >
            {body && <p className="modal-text">{body}</p>}
            {kind === 'ask' && (
                <form onSubmit={accept} className={body ? 'ask-form' : undefined}>
                    {error && <div className="modal-error">{error}</div>}
                    <label className="field">
                        {label && <span>{label}</span>}
                        {multiline ? (
                            <textarea
                                rows={8}
                                value={text}
                                placeholder={placeholder}
                                onChange={(e) => { setText(e.target.value); setError(''); }}
                            />
                        ) : (
                            <input
                                value={text}
                                placeholder={placeholder}
                                onChange={(e) => { setText(e.target.value); setError(''); }}
                            />
                        )}
                    </label>
                </form>
            )}
        </Modal>
    );
}
