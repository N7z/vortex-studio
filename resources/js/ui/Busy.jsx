import React, { useEffect, useState } from 'react';

const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function Busy({ label }) {
    const plain = typeof label === 'string';
    const text = plain ? label : (label?.label ?? null);
    const estimate = plain ? null : (label?.estimate ?? null);
    const reported = plain ? null : label?.progress;
    const [ms, setMs] = useState(0);

    useEffect(() => {
        if (!text) return undefined;
        const from = performance.now();
        setMs(0);
        const id = setInterval(() => setMs(performance.now() - from), 200);

        return () => clearInterval(id);
    }, [text]);

    if (!text) return null;

    const p = Number.isFinite(reported) ? Math.min(Math.max(reported, 0), 1) : null;
    const guessed = Number.isFinite(estimate) && estimate > 0 ? estimate : null;
    const total = p > 0.02 ? ms / p : guessed;
    const share = p ?? (total ? Math.min(ms / total, 1) : null);
    const known = share != null;
    let left = null;
    if (total != null) left = ms < total ? `about ${clock(total - ms)} left` : 'almost done';

    return (
        <div className="busy-backdrop">
            <div className="busy">
                <span className="spinner" />
                <div className="busy-text">
                    <span>{text}</span>
                    <span className="busy-time">
                        {clock(ms)}
                        {left ? ` · ${left}` : ''}
                    </span>
                    {known ? (
                        <span className="busy-bar">
                            <span style={{ width: `${Math.min(share * 100, 99)}%` }} />
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
