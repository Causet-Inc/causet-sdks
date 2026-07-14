import { CausetApiError } from './errors.js';
import { generateIntentId } from './intent-id.js';
import { flattenProjectionItems, stringifyQueryInput } from './query-projection.js';
import { boundFetch } from './fetch.js';
import type { CausetHttpConfig, IntentResult, QueryResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;

function base(cfg: CausetHttpConfig): string {
  return `${cfg.apiUrl.replace(/\/+$/, '')}/v1/platforms/${encodeURIComponent(cfg.platformSlug)}/applications/${encodeURIComponent(cfg.appSlug)}`;
}

function runtimeBase(cfg: CausetHttpConfig): string {
  return `${cfg.apiUrl.replace(/\/+$/, '')}/v1/runtime/platforms/${encodeURIComponent(cfg.platformSlug)}/applications/${encodeURIComponent(cfg.appSlug)}`;
}

function headers(cfg: CausetHttpConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.bearerToken) h.Authorization = `Bearer ${cfg.bearerToken}`;
  return h;
}

async function request<T>(
  fetchImpl: typeof fetch,
  method: string,
  url: string,
  hdrs: Record<string, string>,
  body?: unknown,
  params?: Record<string, string>,
  allow404 = false,
): Promise<T | null> {
  const u = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(u.toString(), {
      method,
      headers: hdrs,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (allow404 && resp.status === 404) return null;
    if (resp.status < 200 || resp.status >= 300) {
      let msg = resp.statusText || 'Request failed';
      let respBody: unknown = null;
      try {
        respBody = await resp.json();
        const b = respBody as {
          error?: string;
          message?: string;
          rejectionMessage?: string;
          rejection_message?: string;
          rejectionCode?: string;
          rejection_code?: string;
        };
        const code = b.rejectionCode || b.rejection_code;
        const detail = b.rejectionMessage || b.rejection_message || b.message || b.error;
        if (code && detail) msg = `${code}: ${detail}`;
        else if (detail) msg = detail;
        else if (code) msg = code;
      } catch {
        /* ignore */
      }
      throw new CausetApiError(resp.status, msg, respBody);
    }
    const text = (await resp.text()).trim();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

function parseSnapshot(data: Record<string, unknown>): { state: unknown; cursor: number } {
  let state: unknown = data;
  const raw = data.snapshotJson;
  if (raw != null) {
    if (typeof raw === 'string') {
      try {
        state = JSON.parse(raw);
      } catch {
        state = data;
      }
    } else {
      state = raw;
    }
  }
  const cursor = (data.snapshotVersion as number) ?? (data.watermark as number) ?? 0;
  return { state, cursor: Number(cursor) || 0 };
}

export async function fetchState(
  cfg: CausetHttpConfig,
  streamId: string,
  entityId: string,
  fetchImpl: typeof fetch = boundFetch,
): Promise<{ state: unknown; cursor: number }> {
  const url = `${base(cfg)}/entities/${encodeURIComponent(streamId)}/${encodeURIComponent(entityId)}/state`;
  const data = await request<Record<string, unknown>>(
    fetchImpl,
    'GET',
    url,
    headers(cfg),
    undefined,
    { forkId: cfg.forkId ?? 'main' },
    true,
  );
  if (!data) return { state: null, cursor: 0 };
  return parseSnapshot(data);
}

export async function emitIntent(
  cfg: CausetHttpConfig,
  streamId: string,
  entityId: string,
  intentType: string,
  payload: Record<string, unknown>,
  intentId?: string,
  fetchImpl: typeof fetch = boundFetch,
): Promise<IntentResult> {
  const url = `${runtimeBase(cfg)}/intents/submit`;
  const body: Record<string, unknown> = {
    intentId: intentId?.trim() || generateIntentId(),
    forkId: cfg.forkId ?? 'main',
    streamId,
    entityId,
    intentType,
    payload,
  };
  const data = await request<Record<string, unknown>>(fetchImpl, 'POST', url, headers(cfg), body);
  const rejectionCode = firstString(data, 'rejectionCode', 'rejection_code', 'code');
  const rejectionMessage = firstString(data, 'rejectionMessage', 'rejection_message', 'message', 'error');
  const accepted = Boolean(data?.accepted);
  return {
    accepted,
    executionId: data?.executionId as string | undefined,
    rejectionCode,
    rejectionMessage,
    error: accepted
      ? undefined
      : formatIntentRejection(rejectionCode, rejectionMessage, intentType),
    statePatch: data?.statePatch ?? data?.state_patch_json,
  };
}

function firstString(data: Record<string, unknown> | null | undefined, ...keys: string[]): string | undefined {
  if (!data) return undefined;
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function formatIntentRejection(
  code: string | undefined,
  message: string | undefined,
  intentType: string,
): string {
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  if (code) return code;
  return `Intent ${intentType} was not accepted`;
}

export async function runQuery(
  cfg: CausetHttpConfig,
  querySlug: string,
  input: Record<string, unknown> | null | undefined,
  opts: {
    limit?: number;
    offset?: number;
    cursor?: string;
    includeTotal?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<QueryResult> {
  const fetchImpl = opts.fetchImpl ?? boundFetch;
  const fork = cfg.forkId ?? 'main';
  const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/queries/${encodeURIComponent(querySlug)}/run`;
  const body: Record<string, unknown> = { input: stringifyQueryInput(input) };
  if (opts.limit != null) body.limit = opts.limit;
  if (opts.cursor != null) body.cursor = opts.cursor;
  else if (opts.offset != null && opts.offset > 0) body.offset = opts.offset;
  if (opts.includeTotal) body.include_total = true;
  const data = await request<QueryResult>(fetchImpl, 'POST', url, headers(cfg), body);
  /* v8 ignore next */
  const result = data ?? { items: [] };
  if (Array.isArray(result.items)) {
    result.items = flattenProjectionItems(result.items) as Record<string, unknown>[];
  }
  return result;
}

export async function listQueries(cfg: CausetHttpConfig, fetchImpl: typeof fetch = boundFetch): Promise<unknown> {
  const fork = cfg.forkId ?? 'main';
  const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/queries`;
  /* v8 ignore next */
  return (await request(fetchImpl, 'GET', url, headers(cfg))) ?? [];
}

export async function getQueryDefinition(
  cfg: CausetHttpConfig,
  querySlug: string,
  fetchImpl: typeof fetch = boundFetch,
): Promise<Record<string, unknown>> {
  const fork = cfg.forkId ?? 'main';
  const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/queries/${encodeURIComponent(querySlug)}`;
  /* v8 ignore next */
  return (await request<Record<string, unknown>>(fetchImpl, 'GET', url, headers(cfg))) ?? {};
}

export async function listProjections(cfg: CausetHttpConfig, fetchImpl: typeof fetch = boundFetch): Promise<unknown> {
  const fork = cfg.forkId ?? 'main';
  const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/projections`;
  /* v8 ignore next */
  return (await request(fetchImpl, 'GET', url, headers(cfg))) ?? [];
}

export async function listEntities(
  cfg: CausetHttpConfig,
  opts: {
    streamName?: string;
    searchPrefix?: string;
    cursor?: string;
    limit?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = opts.fetchImpl ?? boundFetch;
  const params: Record<string, string> = { forkId: cfg.forkId ?? 'main' };
  if (opts.streamName) params.streamName = opts.streamName;
  if (opts.searchPrefix) params.searchPrefix = opts.searchPrefix;
  if (opts.cursor) params.cursor = opts.cursor;
  if (opts.limit != null) params.limit = String(opts.limit);
  const url = `${base(cfg)}/entities`;
  /* v8 ignore next */
  return (await request<Record<string, unknown>>(fetchImpl, 'GET', url, headers(cfg), undefined, params)) ?? {};
}
