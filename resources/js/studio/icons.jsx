import React from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const SelectIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M6 3l12 9-5.2 1.2L15 19l-3 1.4-2.2-5.8L6 17z" />
    </svg>
);

export const MoveIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M12 2v20M2 12h20M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l-2.5 2.5" />
    </svg>
);

export const RotateIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M20 12a8 8 0 1 1-3-6.2" />
        <path d="M17 2l.4 4L21 6" />
    </svg>
);

export const ScaleIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <rect x="3" y="12" width="9" height="9" rx="1" />
        <path d="M13 11l7-7M20 4h-5M20 4v5" />
    </svg>
);

export const PartIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="M12 3v9M4 7.5l8 4.5M20 7.5l-8 4.5M12 21v-9" />
    </svg>
);

export const SpawnIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <ellipse cx="12" cy="17" rx="8" ry="3.5" />
        <path d="M12 3v9M12 12l-3-3M12 12l3-3" />
    </svg>
);

export const CopyIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 15V6a2 2 0 0 1 2-2h9" />
    </svg>
);

export const PasteIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4a3 3 0 0 1 6 0" />
    </svg>
);

export const DuplicateIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 15V6a2 2 0 0 1 2-2h9M14 11v6M11 14h6" />
    </svg>
);

export const SaveIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <path d="M8 3v5h7V3M7 21v-7h10v7" />
    </svg>
);

export const StatsIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
);

export const HelpIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.3 9.2a2.8 2.8 0 1 1 3.9 3c-.8.5-1.2 1-1.2 1.9" />
        <circle cx="12" cy="17.3" r="0.4" fill="currentColor" />
    </svg>
);

export const DownloadIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <path d="M12 3v12M12 15l-4.5-4.5M12 15l4.5-4.5M4 19h16" />
    </svg>
);

export const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M7 4l13 8-13 8z" />
    </svg>
);

export const StopIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
);

export const WorkspaceIcon = () => (
    <svg viewBox="0 0 24 24" fill="#4a9edb" stroke="none">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="#0e0e12" strokeWidth="1.4" fill="none" />
    </svg>
);

export const LightingIcon = () => (
    <svg viewBox="0 0 24 24" fill="#e8c832" stroke="none">
        <path d="M9 3h6l-2 8h4L8 22l2-9H6z" />
    </svg>
);

export const cubeIcon = (color) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 21v-9" />
    </svg>
);

export const StudsIcon = () => (
    <svg viewBox="0 0 24 24" {...S}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.8" />
        <circle cx="15.5" cy="8.5" r="1.8" />
        <circle cx="8.5" cy="15.5" r="1.8" />
        <circle cx="15.5" cy="15.5" r="1.8" />
    </svg>
);
