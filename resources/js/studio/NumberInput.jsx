import React, { useEffect, useRef, useState } from 'react';

export default function NumberInput({ value, onChange, clamp, className = '', ...rest }) {
    const [draft, setDraft] = useState(String(value ?? 0));
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setDraft(String(value ?? 0));
    }, [value]);

    const commit = (text) => {
        const v = parseFloat(text);
        if (Number.isNaN(v)) return;
        onChange(clamp ? clamp(v) : v);
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            className={`num ${className}`.trim()}
            value={draft}
            onFocus={() => { focused.current = true; }}
            onChange={(e) => {
                const text = e.target.value;
                if (!/^-?\d*\.?\d*$/.test(text)) return;
                setDraft(text);
                commit(text);
            }}
            onBlur={() => {
                focused.current = false;
                const v = parseFloat(draft);
                const final = Number.isNaN(v) ? (value ?? 0) : (clamp ? clamp(v) : v);
                setDraft(String(final));
                if (!Number.isNaN(v)) onChange(final);
            }}
            {...rest}
        />
    );
}
