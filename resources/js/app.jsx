import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './studio/App';
import { applyTheme } from './studio/theme';

applyTheme();

const editable = (el) =>
    !!el?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]');

document.addEventListener(
    'contextmenu',
    (e) => {
        if (!editable(e.target)) e.preventDefault();
    },
    true,
);

createRoot(document.getElementById('root')).render(<App />);
