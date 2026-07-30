const DEFAULT_URL = 'ws://localhost:8787';
const RETRY_MS = [500, 1000, 2000, 4000, 8000];
const SELECTION_THROTTLE_MS = 80;
const SELECTION_LIMIT = 256;
const VIEW_THROTTLE_MS = 120;

// A browser on an https page may not open a ws:// socket, so VITE_LIVE_URL is allowed
// to be a bare path ("/live"): the host and the scheme then come from the page, which
// is what makes a reverse-proxied session work in production and plain http work locally.
export function liveUrl() {
    const configured = import.meta.env?.VITE_LIVE_URL?.trim();
    if (!configured) return DEFAULT_URL;

    const secure = window.location.protocol === 'https:';
    if (/^https?:\/\//i.test(configured)) {
        return configured.replace(/^http/i, 'ws');
    }
    if (/^wss?:\/\//i.test(configured)) return configured;

    const path = configured.startsWith('/') ? configured : `/${configured}`;

    return `${secure ? 'wss:' : 'ws:'}//${window.location.host}${path}`;
}

export function blockedAsInsecure(url) {
    return window.location.protocol === 'https:' && /^ws:\/\//i.test(url);
}

export const roomFromUrl = () => {
    const code = new URLSearchParams(window.location.search).get('room');

    return code ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
};

export function shareLink(code) {
    const url = new URL(window.location.href);
    url.search = `?room=${code}`;
    url.hash = '';

    return url.toString();
}

const TOKEN_KEY = (code) => `studio_live_token:${code}`;

const readToken = (code) => {
    try {
        return sessionStorage.getItem(TOKEN_KEY(code));
    } catch {
        return null;
    }
};

const writeToken = (code, token) => {
    try {
        if (token) sessionStorage.setItem(TOKEN_KEY(code), token);
        else sessionStorage.removeItem(TOKEN_KEY(code));
    } catch { /* private mode, the session just will not resume */ }
};

function showRoomInUrl(code) {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
}

export class LiveClient {
    constructor(handlers) {
        this.handlers = handlers;
        this.ws = null;
        this.intent = null;
        this.code = null;
        this.token = null;
        this.attempt = 0;
        this.closing = false;
        this.retryTimer = null;
        this.selectionTimer = null;
        this.pendingSelection = null;
        this.lastSelection = '';
        this.viewTimer = null;
        this.pendingView = null;
        this.lastView = '';
    }

    create(mapName, parts, groups = []) {
        this.intent = {
            t: 'create', mapName, parts, groups,
        };
        this.connect();
    }

    join(code) {
        this.code = code;
        this.token = readToken(code);
        this.intent = { t: 'join', code };
        this.connect();
    }

    connect() {
        this.closing = false;
        const url = liveUrl();
        if (blockedAsInsecure(url)) {
            this.closing = true;
            this.handlers.onStatus?.('offline');
            this.handlers.onError?.('The live server must be wss:// on an https page.');
            this.handlers.onGone?.();

            return;
        }
        this.handlers.onStatus?.(this.attempt ? 'reconnecting' : 'connecting');
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            this.handlers.onError?.(String(e.message ?? e));
            this.handlers.onStatus?.('offline');

            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            this.attempt = 0;
            this.handlers.onStatus?.('connected');
            const hello = this.code
                ? { t: 'join', code: this.code, token: this.token }
                : this.intent;
            ws.send(JSON.stringify(hello));
        };

        ws.onmessage = (e) => {
            let msg;
            try {
                msg = JSON.parse(e.data);
            } catch {
                return;
            }
            this.receive(msg);
        };

        ws.onerror = () => {};

        ws.onclose = (e) => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.stopSelectionTimer();
            this.stopViewTimer();
            // 4003 kicked, 4004 the room refused us. Neither is worth retrying, and
            // retrying a room that no longer exists would loop forever.
            if (this.closing || e.code === 4003 || e.code === 4004) {
                if (e.code === 4004 && this.code) {
                    writeToken(this.code, null);
                    showRoomInUrl(null);
                    this.code = null;
                    this.token = null;
                }
                this.handlers.onStatus?.('offline');
                this.handlers.onGone?.();

                return;
            }
            this.retry();
        };
    }

    retry() {
        if (!this.code) {
            this.handlers.onStatus?.('offline');
            this.handlers.onError?.('Could not reach the live editing server.');

            return;
        }
        const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
        this.attempt += 1;
        this.handlers.onStatus?.('reconnecting');
        this.retryTimer = setTimeout(() => this.connect(), wait);
    }

    receive(msg) {
        switch (msg.t) {
            case 'welcome':
                this.code = msg.code;
                this.token = msg.you.token;
                this.lastSelection = '';
                this.lastView = '';
                writeToken(msg.code, msg.you.token);
                showRoomInUrl(msg.code);
                this.handlers.onWelcome?.(msg);

                return;
            case 'members':
                return this.handlers.onMembers?.(msg);
            case 'op':
                return this.handlers.onOp?.(msg);
            case 'snapshot':
                return this.handlers.onSnapshot?.(msg);
            case 'groups':
                return this.handlers.onGroups?.(msg);
            case 'selection':
                return this.handlers.onSelection?.(msg);
            case 'view':
                return this.handlers.onView?.(msg);
            case 'you':
                return this.handlers.onYou?.(msg);
            case 'saved':
                return this.handlers.onSaved?.(msg);
            case 'kicked':
                this.closing = true;
                writeToken(this.code, null);
                showRoomInUrl(null);

                return this.handlers.onKicked?.(msg);
            case 'error':
                return this.handlers.onError?.(msg.message);
            default:
                return undefined;
        }
    }

    get connected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    send(msg) {
        if (!this.connected) return false;
        this.ws.send(JSON.stringify(msg));

        return true;
    }

    sendOp(op) {
        return this.send({ t: 'op', op });
    }

    sendGroups(groups) {
        return this.send({ t: 'groups', groups });
    }

    setRole(memberId, role) {
        this.send({ t: 'role', memberId, role });
    }

    kick(memberId) {
        this.send({ t: 'kick', memberId });
    }

    notifySaved() {
        this.send({ t: 'saved' });
    }

    resync() {
        this.send({ t: 'resync' });
    }

    stopSelectionTimer() {
        if (!this.selectionTimer) return;
        clearTimeout(this.selectionTimer);
        this.selectionTimer = null;
    }

    stopViewTimer() {
        if (!this.viewTimer) return;
        clearTimeout(this.viewTimer);
        this.viewTimer = null;
    }

    sendView(view) {
        const key = `${view.p.join()}|${view.d.join()}`;
        if (key === this.lastView) return;
        this.lastView = key;
        this.pendingView = view;
        if (this.viewTimer) return;
        this.viewTimer = setTimeout(() => {
            this.viewTimer = null;
            const pending = this.pendingView;
            this.pendingView = null;
            if (pending) this.send({ t: 'view', view: pending });
        }, VIEW_THROTTLE_MS);
    }

    sendSelection(all) {
        const ids = all.length > SELECTION_LIMIT ? all.slice(0, SELECTION_LIMIT) : all;
        const key = ids.join(',');
        if (key === this.lastSelection) return;
        this.lastSelection = key;
        this.pendingSelection = ids;
        if (this.selectionTimer) return;
        this.selectionTimer = setTimeout(() => {
            this.selectionTimer = null;
            const pending = this.pendingSelection;
            this.pendingSelection = null;
            if (pending) this.send({ t: 'selection', ids: pending });
        }, SELECTION_THROTTLE_MS);
    }

    leave() {
        this.closing = true;
        if (this.code) writeToken(this.code, null);
        showRoomInUrl(null);
        this.code = null;
        this.token = null;
        this.stopSelectionTimer();
        this.stopViewTimer();
        this.lastView = '';
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.ws?.close(1000, 'left');
        this.ws = null;
        this.handlers.onStatus?.('offline');
    }
}
