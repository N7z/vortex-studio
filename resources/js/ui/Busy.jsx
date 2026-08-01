import React from 'react';

export default function Busy({ label }) {
    if (!label) return null;

    return (
        <div className="busy-backdrop">
            <div className="busy">
                <span className="spinner" />
                <span>{label}</span>
            </div>
        </div>
    );
}
