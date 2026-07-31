import React, { useState } from 'react';

export default function UpdateNotice({ warning, onReload, onDismiss }) {
    const [busy, setBusy] = useState(false);

    const reload = async () => {
        setBusy(true);
        if (await onReload() === false) setBusy(false);
    };

    return (
        <div className="update-notice">
            <div className="update-title">A new version is available</div>
            {warning && <div className="update-warning">{warning}</div>}
            <div className="update-actions">
                <button className="update-primary" onClick={reload} disabled={busy}>
                    {busy ? 'Saving…' : 'Reload'}
                </button>
                <button className="update-later" onClick={onDismiss} disabled={busy}>Later</button>
            </div>
        </div>
    );
}
