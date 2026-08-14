import { WebSocket } from 'ws';

const CONNECT_TIMEOUT_MS = 10_000;

export class LiveError extends Error {}

export class LiveSession {
    constructor({ url, origin, onState = () => {} }) {
        this.url = url;
        this.origin = origin;
        this.onState = onState;
        this.ws = null;
        this.code = null;
        this.mapName = null;
        this.teamMap = false;
        this.you = null;
        this.members = [];
        this.seq = 0;
        this.lastError = null;
        this.doc = null;
        this.closed = true;
    }

    get connected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    get canEdit() {
        return !!this.you && (this.you.owner || this.you.role === 'developer');
    }

    bind(doc) {
        this.doc = doc;
        doc.attach(this);

        return doc;
    }

    unbind() {
        this.doc?.attach(null);
        this.doc = null;
    }

    open(hello) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn(value);
            };

            const timer = setTimeout(() => {
                this.ws?.terminate();
                finish(reject, new LiveError(
                    `the live server at ${this.url} did not answer within ${CONNECT_TIMEOUT_MS / 1000}s`,
                ));
            }, CONNECT_TIMEOUT_MS);

            let ws;
            try {
                ws = new WebSocket(this.url, { origin: this.origin });
            } catch (e) {
                return finish(reject, new LiveError(`cannot open ${this.url}: ${e.message}`));
            }
            this.ws = ws;
            this.closed = false;

            ws.on('open', () => ws.send(JSON.stringify(hello)));

            ws.on('message', (raw) => {
                let msg;
                try {
                    msg = JSON.parse(raw.toString());
                } catch {
                    return;
                }
                this.receive(msg);
                if (msg.t === 'welcome') {
                    finish(resolve, {
                        code: this.code,
                        mapName: this.mapName,
                        you: this.you,
                        members: this.members,
                        parts: msg.parts.length,
                    });
                }
                if (msg.t === 'error') this.lastError = msg.message;
            });

            ws.on('close', (codeNum) => {
                const why = this.lastError ?? `the live server closed the connection (${codeNum})`;
                this.ws = null;
                this.closed = true;
                this.onState({ connected: false, reason: why });
                finish(reject, new LiveError(why));
            });

            ws.on('error', (e) => finish(reject, new LiveError(`live connection failed: ${e.message}`)));

            return undefined;
        });
    }

    receive(msg) {
        switch (msg.t) {
            case 'welcome':
                this.code = msg.code;
                this.mapName = msg.mapName;
                this.teamMap = !!msg.teamMap;
                this.you = msg.you;
                this.members = msg.members ?? [];
                this.seq = msg.seq ?? 0;
                this.doc?.reset({
                    parts: msg.parts ?? [],
                    groups: msg.groups ?? [],
                    lighting: msg.lighting ?? null,
                });
                break;
            case 'members':
                this.members = msg.members ?? [];
                break;
            case 'you':
                if (this.you) this.you = { ...this.you, role: msg.role, owner: msg.owner };
                break;
            case 'op':
                this.seq = msg.seq ?? this.seq;
                if (msg.from !== this.you?.id) this.doc?.applyRemote(msg.op);
                break;
            case 'gop':
                if (msg.from !== this.you?.id) this.doc?.applyRemoteGroupOp(msg.op);
                break;
            case 'groups':
                if (msg.from !== this.you?.id) this.doc?.setRemoteGroups(msg.groups);
                break;
            case 'lighting':
                if (msg.from !== this.you?.id) this.doc?.setRemoteLighting(msg.lighting);
                break;
            case 'snapshot':
                this.seq = msg.seq ?? this.seq;
                this.doc?.reset({
                    parts: msg.parts ?? [],
                    groups: msg.groups ?? [],
                    lighting: msg.lighting ?? null,
                });
                break;
            case 'kicked':
                this.lastError = msg.reason ?? 'removed from the session';
                break;
            case 'error':
                this.lastError = msg.message;
                break;
            default:
                break;
        }
    }

    send(msg) {
        if (!this.connected) return false;
        this.ws.send(JSON.stringify(msg));

        return true;
    }

    sendOp(op) {
        return this.send({ t: 'op', op });
    }

    sendGroupOp(op) {
        return this.send({ t: 'gop', op });
    }

    sendGroups(groups) {
        return this.send({ t: 'groups', groups });
    }

    sendLighting(lighting) {
        return this.send({ t: 'lighting', lighting });
    }

    sendSelection(ids) {
        return this.send({ t: 'selection', ids: ids.slice(0, 200) });
    }

    sendChat(text) {
        return this.send({ t: 'chat', text });
    }

    resync() {
        return this.send({ t: 'resync' });
    }

    leave() {
        this.unbind();
        this.closed = true;
        this.lastError = null;
        this.ws?.close(1000, 'left');
        this.ws = null;
        this.code = null;
        this.you = null;
        this.members = [];
    }
}

export function joinHello(code, identity) {
    return { t: 'join', code, identity };
}

export function createHello(mapName, parts, groups, lighting, identity) {
    return {
        t: 'create', mapName, parts, groups, lighting, identity,
    };
}

export function openHello(mapName, parts, groups, lighting, teamId, identity) {
    return {
        t: 'open', mapName, parts, groups, lighting, teamId, identity,
    };
}
