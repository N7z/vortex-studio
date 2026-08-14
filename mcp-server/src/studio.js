export class StudioError extends Error {}

export class Studio {
    constructor({ baseUrl }) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.cookies = new Map();
        this.csrf = '';
        this.account = null;
    }

    get signedIn() {
        return !!this.account;
    }

    cookieHeader() {
        return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    absorb(response) {
        const raw = typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : [response.headers.get('set-cookie')].filter(Boolean);

        for (const line of raw) {
            const [pair] = line.split(';');
            const at = pair.indexOf('=');
            if (at < 1) continue;
            this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
        }
    }

    async request(path, { method = 'GET', body = null, headers: extra = {} } = {}) {
        const headers = {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...extra,
        };
        const cookie = this.cookieHeader();
        if (cookie) headers.Cookie = cookie;
        if (body) {
            headers['Content-Type'] = 'application/json';
            if (this.csrf) headers['X-CSRF-TOKEN'] = this.csrf;
        }

        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                redirect: 'manual',
            });
        } catch (e) {
            throw new StudioError(
                `cannot reach the Studio at ${this.baseUrl}: ${e.message}. `
                + 'Is "php artisan serve" running, and is STUDIO_URL right?',
            );
        }

        this.absorb(response);
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = {};
        }
        if (data.csrf) this.csrf = data.csrf;

        if (!response.ok) {
            const first = data.errors && Object.values(data.errors)[0]?.[0];
            throw new StudioError(first || data.message || `${method} ${path} failed with ${response.status}`);
        }

        return data;
    }

    async primeCsrf() {
        const cookie = this.cookieHeader();
        const response = await fetch(this.baseUrl, {
            headers: cookie ? { Cookie: cookie } : {},
            redirect: 'manual',
        }).catch((e) => {
            throw new StudioError(`cannot reach the Studio at ${this.baseUrl}: ${e.message}`);
        });
        this.absorb(response);
        const html = await response.text();
        const meta = /<meta name="csrf-token" content="([^"]+)"/.exec(html);
        if (meta) this.csrf = meta[1];
    }

    async login(email, password) {
        await this.primeCsrf();
        const data = await this.request('/account/login', {
            method: 'POST',
            body: { email, password, remember: true },
        });
        this.account = data.account ?? null;
        if (!this.account) throw new StudioError('the Studio accepted the login but returned no account');

        return this.account;
    }

    async me() {
        const data = await this.request('/account');
        this.account = data.account ?? null;

        return this.account;
    }

    async liveToken(mapName, teamId, agent = true) {
        const q = new URLSearchParams();
        if (mapName) q.set('map', mapName);
        if (teamId != null) q.set('team', String(teamId));
        if (agent) q.set('agent', '1');
        const data = await this.request(`/account/live-token?${q}`);
        if (!data.token) {
            throw new StudioError(
                'the Studio returned no live token. Sign in first, and make sure LIVE_SECRET is set '
                + 'in the Laravel .env (services.live.secret).',
            );
        }

        return data.token;
    }

    listMaps() {
        return this.request('/api/maps');
    }

    loadMap(name, teamId = null) {
        const q = teamId != null ? `?team=${teamId}` : '';

        return this.request(`/api/maps/${encodeURIComponent(name)}${q}`);
    }

    saveMap(name, {
        parts, groups, lighting, projectId, teamId = null, version = null, confirm = false,
    }) {
        const q = teamId != null ? `?team=${teamId}` : '';

        return this.request(`/api/maps/${encodeURIComponent(name)}${q}`, {
            method: 'PUT',
            headers: confirm ? { 'X-Confirm-Destructive': '1' } : {},
            body: {
                parts,
                groups,
                lighting,
                project_id: projectId ?? null,
                version,
            },
        });
    }
}
