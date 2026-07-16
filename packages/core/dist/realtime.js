const REALTIME_HOST_BY_API = {
    'sandbox.api.causet.cloud': 'sandbox.realtime.causet.cloud',
    'api.causet.cloud': 'realtime.causet.cloud',
};
/**
 * HTTP base URL for causet-realtime (SSE).
 * Maps API URLs to the dedicated realtime service — not the Causet Cloud gateway host.
 */
export function deriveRealtimeUrl(apiUrl) {
    const trimmed = apiUrl.replace(/\/+$/, '');
    try {
        const url = new URL(trimmed);
        const mapped = REALTIME_HOST_BY_API[url.hostname];
        if (mapped) {
            url.hostname = mapped;
            return url.origin;
        }
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            const port = url.port === '8085' || url.port === '' ? '8081' : url.port;
            return `${url.protocol}//${url.hostname}:${port}`;
        }
        if (url.hostname.includes('.api.')) {
            url.hostname = url.hostname.replace('.api.', '.realtime.');
            return url.origin;
        }
    }
    catch {
        /* ignore invalid URL */
    }
    return trimmed;
}
/** WebSocket URL from causet-realtime HTTP base. */
export function deriveWsUrlFromRealtime(realtimeUrl) {
    const u = realtimeUrl.replace(/\/+$/, '');
    if (u.startsWith('https://'))
        return u.replace('https://', 'wss://') + '/ws';
    if (u.startsWith('http://'))
        return u.replace('http://', 'ws://') + '/ws';
    return `${u}/ws`;
}
/** WebSocket URL derived from API URL. */
export function deriveWsUrl(apiUrl) {
    return deriveWsUrlFromRealtime(deriveRealtimeUrl(apiUrl));
}
/**
 * Canonical SSE stream events endpoint:
 * GET /v1/platforms/{platformId}/applications/{applicationId}/streams/{streamId}/events
 *
 * Prefer resolved UUIDs (`platformId` / `applicationId`) — hub fanout matches event
 * platform/application ids, not slugs. Slugs are a fallback for hosted JWTs that
 * already embed the same identifiers.
 */
export function buildStreamEventsUrl(realtimeUrl, cfg, opts) {
    const base = deriveRealtimeUrl(realtimeUrl);
    const forkId = opts.forkId ?? cfg.forkId ?? 'main';
    const platform = cfg.platformId || cfg.platformSlug;
    const application = cfg.applicationId || cfg.appSlug;
    const u = new URL(`${base}/v1/platforms/${encodeURIComponent(platform)}/applications/${encodeURIComponent(application)}/streams/${encodeURIComponent(opts.streamId)}/events`);
    u.searchParams.set('fork_id', forkId);
    // Include 0 and -1 (live-only). Only omit when caller leaves fromCursor undefined.
    if (opts.fromCursor != null) {
        u.searchParams.set('from_cursor', String(opts.fromCursor));
    }
    if (opts.token)
        u.searchParams.set('token', opts.token);
    if (opts.apiKey)
        u.searchParams.set('api_key', opts.apiKey);
    return u.toString();
}
