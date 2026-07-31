import { useEffect, useState } from 'react';

const QUERY = '(pointer: coarse) and (max-width: 900px)';

const forced = () => {
    try {
        return new URLSearchParams(window.location.search).get('ui');
    } catch {
        return null;
    }
};

export const isMobileNow = () => {
    const override = forced();
    if (override === 'mobile') return true;
    if (override === 'desktop') return false;

    return window.matchMedia?.(QUERY).matches ?? false;
};

export default function useIsMobile() {
    const [mobile, setMobile] = useState(isMobileNow);

    useEffect(() => {
        const mq = window.matchMedia?.(QUERY);
        if (!mq) return undefined;
        const on = () => setMobile(isMobileNow());
        mq.addEventListener('change', on);
        window.addEventListener('orientationchange', on);

        return () => {
            mq.removeEventListener('change', on);
            window.removeEventListener('orientationchange', on);
        };
    }, []);

    return mobile;
}
