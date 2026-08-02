const DEFAULT_URL = 'ws://localhost:8787';
const RETRY_MS = [500, 1000, 2000, 4000, 8000];
const SELECTION_THROTTLE_MS = 80;
// Must match the server's own cap, or the echo comes back smaller than what was sent.
export const SELECTION_LIMIT = 200;
const VIEW_THROTTLE_MS = 120;
const PLAY_THROTTLE_MS = 50;

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
        this.identity = null;
        this.intent = null;
        this.lastError = null;
        this.code = null;
        this.token = null;
        this.attempt = 0;
        this.closing = false;
        this.generation = 0;
        this.retryTimer = null;
        this.selectionTimer = null;
        this.pendingSelection = null;
        this.lastSelection = '';
        this.viewTimer = null;
        this.pendingView = null;
        this.lastView = '';
        this.playTimer = null;
        this.pendingPlay = undefined;
        this.lastPlay = 'off';
    }

    create(mapName, parts, groups = []) {
        this.intent = {
            t: 'create', mapName, parts, groups,
        };
        this.connect();
    }

    openTeam(mapName, parts, groups = [], teamId = null) {
        this.intent = {
            t: 'open', mapName, parts, groups, teamId,
        };
        this.connect();
    }

    join(code) {
        this.code = code;
        this.token = readToken(code);
        this.intent = { t: 'join', code };
        this.connect();
    }

    // Detaches the handlers first, so the close does not read as a lost connection
    // and start a retry against the socket that replaced it.
    dropSocket() {
        const ws = this.ws;
        if (!ws) return;
        this.ws = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close(1000, 'superseded');
    }

    async connect() {
        this.closing = false;
        const gen = ++this.generation;
        this.dropSocket();
        // Refetched per attempt: the proof expires, and a reconnect can be much later.
        this.identity = await this.handlers.onIdentity?.().catch(() => null) ?? null;
        if (this.closing || gen !== this.generation) return;
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
            ws.send(JSON.stringify({ ...hello, identity: this.identity }));
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
            this.stopPlayTimer();
            // 4003 kicked, 4004 the room refused us. Neither is worth retrying, and
            // retrying a room that no longer exists would loop forever.
            if (this.closing || e.code === 4003 || e.code === 4004) {
                if (e.code === 4004) {
                    if (this.code) {
                        writeToken(this.code, null);
                        showRoomInUrl(null);
                        this.code = null;
                        this.token = null;
                    }
                    // Being turned away is not the same as losing the connection:
                    // leaving the map open would look like an editable offline copy.
                    this.handlers.onRefused?.(this.lastError);
                }
                this.lastError = null;
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
                this.lastPlay = 'off';
                writeToken(msg.code, msg.you.token);
                // A team room has no shareable code, so it never goes in the address bar.
                showRoomInUrl(msg.teamMap ? null : msg.code);
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
            case 'gop':
                return this.handlers.onGroupOp?.(msg);
            case 'selection':
                return this.handlers.onSelection?.(msg);
            case 'chat':
                return this.handlers.onChat?.(msg);
            case 'view':
                return this.handlers.onView?.(msg);
            case 'play':
                return this.handlers.onPlay?.(msg);
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
                this.lastError = msg.message;
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

    sendGroupOp(op) {
        return this.send({ t: 'gop', op });
    }

    sendChat(text) {
        return this.send({ t: 'chat', text });
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

    stopPlayTimer() {
        this.lastPlay = 'off';
        this.pendingPlay = undefined;
        if (!this.playTimer) return;
        clearTimeout(this.playTimer);
        this.playTimer = null;
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

    sendPlay(state) {
        const play = state ? {
            x: state.x,
            y: state.y,
            z: state.z,
            yaw: state.yaw,
            moving: !!state.moving,
            grounded: !!state.grounded,
            dead: !!state.dead,
        } : null;
        const key = play
            ? `${play.x.toFixed(2)},${play.y.toFixed(2)},${play.z.toFixed(2)},${play.yaw.toFixed(3)}`
              + `,${play.moving},${play.grounded},${play.dead}`
            : 'off';
        if (key === this.lastPlay) return;
        this.lastPlay = key;
        this.pendingPlay = play;
        if (this.playTimer) return;
        this.playTimer = setTimeout(() => {
            this.playTimer = null;
            const pending = this.pendingPlay;
            this.pendingPlay = undefined;
            if (pending !== undefined) this.send({ t: 'play', play: pending });
        }, PLAY_THROTTLE_MS);
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
        this.generation += 1;
        if (this.code) writeToken(this.code, null);
        showRoomInUrl(null);
        this.code = null;
        this.token = null;
        this.stopSelectionTimer();
        this.stopViewTimer();
        this.stopPlayTimer();
        this.lastView = '';
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.ws?.close(1000, 'left');
        this.ws = null;
        this.handlers.onStatus?.('offline');
    }
}
