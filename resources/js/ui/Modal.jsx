import React, { useEffect, useRef } from 'react';

export default function Modal({
    title, subtitle, onClose, children, footer, wide,
}) {
    const card = useRef(null);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', onKey);
        card.current?.querySelector('input, select, button')?.focus();

        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className={`modal${wide ? ' modal-wide' : ''}`} ref={card} role="dialog" aria-modal="true">
                <header className="modal-head">
                    <div>
                        <h3>{title}</h3>
                        {subtitle && <p>{subtitle}</p>}
                    </div>
                    <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
                </header>
                <div className="modal-body">{children}</div>
                {footer && <footer className="modal-foot">{footer}</footer>}
            </div>
        </div>
    );
}

export function Confirm({
    title, body, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose,
}) {
    return (
        <Modal
            title={title}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className={danger ? 'btn btn-danger' : 'btn btn-go'}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? 'Working…' : confirmLabel}
                    </button>
                </>
            )}
        >
            <p className="modal-text">{body}</p>
        </Modal>
    );
}
