import { CausetApiError } from './errors.js';
import { generateIntentId } from './intent-id.js';
import { flattenProjectionItems, stringifyQueryInput } from './query-projection.js';
import { boundFetch } from './fetch.js';
const DEFAULT_TIMEOUT_MS = 120_000;
function base(cfg) {
    return `${cfg.apiUrl.replace(/\/+$/, '')}/v1/platforms/${encodeURIComponent(cfg.platformSlug)}/applications/${encodeURIComponent(cfg.appSlug)}`;
}
function runtimeBase(cfg) {
    return `${cfg.apiUrl.replace(/\/+$/, '')}/v1/runtime/platforms/${encodeURIComponent(cfg.platformSlug)}/applications/${encodeURIComponent(cfg.appSlug)}`;
}
function headers(cfg) {
    const h = { 'Content-Type': 'application/json' };
    if (cfg.bearerToken)
        h.Authorization = `Bearer ${cfg.bearerToken}`;
    return h;
}
async function request(fetchImpl, method, url, hdrs, body, params, allow404 = false) {
    const u = new URL(url);
    if (params) {
        for (const [k, v] of Object.entries(params))
            u.searchParams.set(k, v);
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
        if (allow404 && resp.status === 404)
            return null;
        if (resp.status < 200 || resp.status >= 300) {
            let msg = resp.statusText || 'Request failed';
            let respBody = null;
            try {
                respBody = await resp.json();
                const b = respBody;
                const code = b.rejectionCode || b.rejection_code;
                const detail = b.rejectionMessage || b.rejection_message || b.message || b.error;
                if (code && detail)
                    msg = `${code}: ${detail}`;
                else if (detail)
                    msg = detail;
                else if (code)
                    msg = code;
            }
            catch {
                /* ignore */
            }
            throw new CausetApiError(resp.status, msg, respBody);
        }
        const text = (await resp.text()).trim();
        if (!text)
            return {};
        return JSON.parse(text);
    }
    finally {
        clearTimeout(timer);
    }
}
function parseSnapshot(data) {
    let state = data;
    const raw = data.snapshotJson;
    if (raw != null) {
        if (typeof raw === 'string') {
            try {
                state = JSON.parse(raw);
            }
            catch {
                state = data;
            }
        }
        else {
            state = raw;
        }
    }
    const cursor = data.snapshotVersion ?? data.watermark ?? 0;
    return { state, cursor: Number(cursor) || 0 };
}
export async function fetchState(cfg, streamId, entityId, fetchImpl = boundFetch) {
    const url = `${base(cfg)}/entities/${encodeURIComponent(streamId)}/${encodeURIComponent(entityId)}/state`;
    const data = await request(fetchImpl, 'GET', url, headers(cfg), undefined, { forkId: cfg.forkId ?? 'main' }, true);
    if (!data)
        return { state: null, cursor: 0 };
    return parseSnapshot(data);
}
export async function submitIntent(cfg, streamId, entityId, intentType, payload, intentId, fetchImpl = boundFetch) {
    const url = `${runtimeBase(cfg)}/intents/submit`;
    const body = {
        intentId: intentId?.trim() || generateIntentId(),
        forkId: cfg.forkId ?? 'main',
        streamId,
        entityId,
        intentType,
        payload,
    };
    const data = await request(fetchImpl, 'POST', url, headers(cfg), body);
    const rejectionCode = firstString(data, 'rejectionCode', 'rejection_code', 'code');
    const rejectionMessage = firstString(data, 'rejectionMessage', 'rejection_message', 'message', 'error');
    const accepted = Boolean(data?.accepted);
    return {
        accepted,
        executionId: data?.executionId,
        rejectionCode,
        rejectionMessage,
        error: accepted
            ? undefined
            : formatIntentRejection(rejectionCode, rejectionMessage, intentType),
        statePatch: data?.statePatch ?? data?.state_patch_json,
    };
}
function firstString(data, ...keys) {
    if (!data)
        return undefined;
    for (const k of keys) {
        const v = data[k];
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    return undefined;
}
function formatIntentRejection(code, message, intentType) {
    if (code && message)
        return `${code}: ${message}`;
    if (message)
        return message;
    if (code)
        return code;
    return `Intent ${intentType} was not accepted`;
}
export async function runQuery(cfg, querySlug, input, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? boundFetch;
    const fork = cfg.forkId ?? 'main';
    const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/queries/${encodeURIComponent(querySlug)}/run`;
    const body = { input: stringifyQueryInput(input) };
    if (opts.limit != null)
        body.limit = opts.limit;
    if (opts.cursor != null)
        body.cursor = opts.cursor;
    else if (opts.offset != null && opts.offset > 0)
        body.offset = opts.offset;
    if (opts.includeTotal)
        body.include_total = true;
    const data = await request(fetchImpl, 'POST', url, headers(cfg), body);
    /* v8 ignore next */
    const result = data ?? { items: [] };
    if (Array.isArray(result.items)) {
        result.items = flattenProjectionItems(result.items);
    }
    return result;
}
export async function listQueries(cfg, fetchImpl = boundFetch) {
    const fork = cfg.forkId ?? 'main';
    const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/queries`;
    /* v8 ignore next */
    return (await request(fetchImpl, 'GET', url, headers(cfg))) ?? [];
}
export async function getQueryDefinition(cfg, querySlug, fetchImpl = boundFetch) {
    const fork = cfg.forkId ?? 'main';
    const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/queries/${encodeURIComponent(querySlug)}`;
    /* v8 ignore next */
    return (await request(fetchImpl, 'GET', url, headers(cfg))) ?? {};
}
export async function listProjections(cfg, fetchImpl = boundFetch) {
    const fork = cfg.forkId ?? 'main';
    const url = `${base(cfg)}/forks/${encodeURIComponent(fork)}/projections`;
    /* v8 ignore next */
    return (await request(fetchImpl, 'GET', url, headers(cfg))) ?? [];
}
export async function listEntities(cfg, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? boundFetch;
    const params = { forkId: cfg.forkId ?? 'main' };
    if (opts.streamName)
        params.streamName = opts.streamName;
    if (opts.searchPrefix)
        params.searchPrefix = opts.searchPrefix;
    if (opts.cursor)
        params.cursor = opts.cursor;
    if (opts.limit != null)
        params.limit = String(opts.limit);
    const url = `${base(cfg)}/entities`;
    /* v8 ignore next */
    return (await request(fetchImpl, 'GET', url, headers(cfg), undefined, params)) ?? {};
}
