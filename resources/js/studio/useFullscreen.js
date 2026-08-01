import { useEffect, useState } from 'react';

export const canFullscreen = () => typeof document.documentElement.requestFullscreen === 'function';

export default function useFullscreen() {
    const [full, setFull] = useState(false);

    useEffect(() => {
        const on = () => setFull(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', on);

        return () => document.removeEventListener('fullscreenchange', on);
    }, []);

    const toggle = () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => {});
    };

    return [full, toggle];
}
