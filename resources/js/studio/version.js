const POLL_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

const current = document.querySelector('meta[name="build"]')?.content ?? '';

// Deployed assets are hashed, so a tab keeps running the bundle it loaded with until
// it is reloaded. Watch for the build changing under it and let the caller say so.
export function watchForUpdate(onUpdate) {
    if (!current) return () => {};

    let stopped = false;
    let checkedAt = 0;

    const timer = setInterval(() => check(), POLL_MS);
    const onVisible = () => { if (!document.hidden) check(); };
    // A chunk that no longer exists is a deploy that already happened.
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
            // Offline or a container restarting mid-deploy: the next poll decides.
        }
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('vite:preloadError', onPreloadError);
    return stop;
}
