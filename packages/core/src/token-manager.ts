import { CausetAuthError } from './errors.js';
import { deriveWsUrl as deriveWsUrlFromRealtime } from './realtime.js';
import { boundFetch } from './fetch.js';

const REFRESH_BUFFER_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 350;

export class ApiKeyTokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = boundFetch,
  ) {}

  async getToken(): Promise<string> {
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
    } finally {
      this.inflight = null;
    }
  }

  async init(): Promise<void> {
    await this.getToken();
  }

  async forceRefresh(): Promise<string> {
    this.destroyTimers();
    this.token = null;
    this.expiresAt = 0;
    return this.getToken();
  }

  destroy(): void {
    this.destroyTimers();
  }

  private destroyTimers(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async exchange(): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await this.fetchImpl(`${this.apiUrl.replace(/\/+$/, '')}/v1/token`, {
          method: 'POST',
          headers: { Authorization: `ApiKey ${this.apiKey}` },
        });
        if (!resp.ok) {
          let msg = `Token exchange failed: ${resp.status}`;
          try {
            const body = (await resp.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* ignore */
          }
          throw new CausetAuthError(msg);
        }
        const data = (await resp.json()) as { token?: string; expiresIn?: number };
        if (!data.token) {
          throw new CausetAuthError('Token exchange returned no token');
        }
        this.token = data.token;
        this.expiresAt = Date.now() + (data.expiresIn ?? 300) * 1000;
        this.scheduleRefresh();
        return this.token;
      } catch (e) {
        lastError = e;
        if (e instanceof CausetAuthError) throw e;
        if (attempt + 1 >= MAX_ATTEMPTS) break;
        await sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }
    throw new CausetAuthError(
      `Causet auth unreachable: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
    );
  }

  private scheduleRefresh(): void {
    this.destroyTimers();
    const delay = this.expiresAt - Date.now() - REFRESH_BUFFER_MS;
    if (delay <= 0) return;
    this.refreshTimer = setTimeout(() => {
      this.exchange().catch(() => undefined);
    }, delay);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function orgIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = 4 - (payload.length % 4);
    if (pad !== 4) payload += '='.repeat(pad);
    const json = JSON.parse(atob(payload)) as { org_id?: string };
    return json.org_id ?? null;
  } catch {
    return null;
  }
}

/** @deprecated Import from realtime.js */
export function deriveWsUrl(apiUrl: string): string {
  return deriveWsUrlFromRealtime(apiUrl);
}
