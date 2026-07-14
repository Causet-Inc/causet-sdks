import { CausetAuthError } from './errors.js';
import { deriveWsUrl as deriveWsUrlFromRealtime } from './realtime.js';
import { boundFetch } from './fetch.js';
const REFRESH_BUFFER_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 350;
export class ApiKeyTokenManager {
    apiUrl;
    apiKey;
    fetchImpl;
    token = null;
    expiresAt = 0;
    inflight = null;
    refreshTimer = null;
    constructor(apiUrl, apiKey, fetchImpl = boundFetch) {
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.fetchImpl = fetchImpl;
    }
    async getToken() {
        const refreshAt = this.expiresAt - REFRESH_BUFFER_MS;
        if (this.token && Date.now() < refreshAt) {
            return this.token;
        }
        if (this.inflight) {
            return this.inflight;
        }
        this.inflight = this.exchange();
        try {
            return await this.inflight;
        }
        finally {
            this.inflight = null;
        }
    }
    async init() {
        await this.getToken();
    }
    async forceRefresh() {
        this.destroyTimers();
        this.token = null;
        this.expiresAt = 0;
        return this.getToken();
    }
    destroy() {
        this.destroyTimers();
    }
    destroyTimers() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    async exchange() {
        let lastError;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                const resp = await this.fetchImpl(`${this.apiUrl.replace(/\/+$/, '')}/v1/token`, {
                    method: 'POST',
                    headers: { Authorization: `ApiKey ${this.apiKey}` },
                });
                if (!resp.ok) {
                    let msg = `Token exchange failed: ${resp.status}`;
                    try {
                        const body = (await resp.json());
                        if (body.error)
                            msg = body.error;
                    }
                    catch {
                        /* ignore */
                    }
                    throw new CausetAuthError(msg);
                }
                const data = (await resp.json());
                if (!data.token) {
                    throw new CausetAuthError('Token exchange returned no token');
                }
                this.token = data.token;
                this.expiresAt = Date.now() + (data.expiresIn ?? 300) * 1000;
                this.scheduleRefresh();
                return this.token;
            }
            catch (e) {
                lastError = e;
                if (e instanceof CausetAuthError)
                    throw e;
                if (attempt + 1 >= MAX_ATTEMPTS)
                    break;
                await sleep(RETRY_BASE_MS * 2 ** attempt);
            }
        }
        throw new CausetAuthError(`Causet auth unreachable: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
    }
    scheduleRefresh() {
        this.destroyTimers();
        const delay = this.expiresAt - Date.now() - REFRESH_BUFFER_MS;
        if (delay <= 0)
            return;
        this.refreshTimer = setTimeout(() => {
            this.exchange().catch(() => undefined);
        }, delay);
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
export function orgIdFromToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length < 2)
            return null;
        let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = 4 - (payload.length % 4);
        if (pad !== 4)
            payload += '='.repeat(pad);
        const json = JSON.parse(atob(payload));
        return json.org_id ?? null;
    }
    catch {
        return null;
    }
}
/** @deprecated Import from realtime.js */
export function deriveWsUrl(apiUrl) {
    return deriveWsUrlFromRealtime(apiUrl);
}
