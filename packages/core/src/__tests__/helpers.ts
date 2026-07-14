import { vi } from 'vitest';

export const BASE = 'https://api.causet.cloud';
export const PREFIX = `${BASE}/v1/platforms/org1/applications/app1`;
export const RUNTIME_PREFIX = `${BASE}/v1/runtime/platforms/org1/applications/app1`;
export const STREAM_URL = `${BASE}/v1/runtime/stream/platforms/org1/applications/app1/intents/submit`;

export const CFG = {
  apiUrl: BASE,
  platformSlug: 'org1',
  appSlug: 'app1',
  forkId: 'main',
  bearerToken: 'jwt-test',
};

export const CFG_NO_FORK = {
  apiUrl: BASE,
  platformSlug: 'org1',
  appSlug: 'app1',
  bearerToken: 'jwt-test',
};

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function createMockFetch(handlers: FetchHandler[]): typeof fetch {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const handler of handlers) {
      const resp = await handler(url, init);
      if (resp) return resp;
    }
    throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url}`);
  });
  return fn as typeof fetch;
}

export function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers });
}

export function emptyResponse(status = 200): Response {
  return new Response('', { status });
}

/** JWT payload with org_id for WebSocket project_id resolution. */
export function jwtWithOrgId(orgId: string): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const payload = btoa(JSON.stringify({ org_id: orgId }));
  return `${header}.${payload}.sig`;
}
