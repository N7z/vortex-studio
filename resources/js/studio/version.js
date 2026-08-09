const POLL_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

const current = document.querySelector('meta[name="build"]')?.content ?? '';

export function watchForUpdate(onUpdate) {
    if (!current) return () => {};

    let stopped = false;
    let checkedAt = 0;

    const timer = setInterval(() => check(), POLL_MS);
    const onVisible = () => { if (!document.hidden) check(); };
    const onPreloadError = () => announce();

    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('vite:preloadError', onPreloadError);
    }

    function announce() {
        if (stopped) return;
        stop();
        onUpdate();
    }

    async function check() {
        if (stopped || document.hidden || Date.now() - checkedAt < MIN_GAP_MS) return;
        checkedAt = Date.now();
        try {
            const r = await fetch('/api/build', { cache: 'no-store' });
            if (!r.ok) return;
            const { build } = await r.json();
            if (build && build !== current) announce();
        } catch {
        }
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('vite:preloadError', onPreloadError);
    return stop;
}
