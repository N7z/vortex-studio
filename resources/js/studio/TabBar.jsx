import React from 'react';
import { PluginIcon } from './pluginIcons';

export default function TabBar({ tabs, active, onSelect, onClose }) {
    return (
        <div className="tabbar">
            {tabs.map((t) => {
                return (
                <div
                    key={t.id}
                    className={`tab ${active === t.id ? 'active' : ''}`}
                    onClick={() => onSelect(t.id)}
                >
                    <PluginIcon name={t.icon} className="tab-icon" size={14} />
                    {t.title}
                    {t.closable && (
                        <button
                            className="tab-x"
                            onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                            title="Close"
                        >
                            ×
                        </button>
                    )}
                </div>
                );
            })}
        </div>
    );
}
