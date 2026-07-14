export interface CausetHttpConfig {
    apiUrl: string;
    platformSlug: string;
    appSlug: string;
    forkId?: string;
    bearerToken?: string;
    /** Resolved platform UUID for realtime SSE paths (preferred over slug). */
    platformId?: string;
    /** Resolved application UUID for realtime SSE paths (preferred over slug). */
    applicationId?: string;
}
export interface IntentResult {
    accepted: boolean;
    executionId?: string;
    /** Human-readable failure summary (rejection message / error). */
    error?: string;
    rejectionCode?: string;
    rejectionMessage?: string;
    statePatch?: unknown;
}
export interface QueryResult {
    items: Record<string, unknown>[];
    next_cursor?: string | null;
    total_count?: number | null;
    meta?: Record<string, unknown>;
    platform?: string;
    application?: string;
}
export interface SseEvent {
    id?: string;
    event?: string;
    data: unknown;
}
export interface CausetClientOptions {
    apiUrl: string;
    platformSlug: string;
    appSlug: string;
    forkId?: string;
    /**
     * Platform UUID for realtime SSE URLs. When omitted, call `resolveIds()`
     * (or pass after resolving via CLI/platform APIs). Hub fanout matches UUIDs.
     */
    platformId?: string;
    /** Application UUID for realtime SSE URLs (see platformId). */
    applicationId?: string;
    /** WebSocket URL for causet-realtime (default derived from apiUrl). */
    wsUrl?: string;
    /** HTTP base URL for causet-realtime SSE (default derived from apiUrl). */
    realtimeUrl?: string;
    /** Default live stream transport: websocket (duplex) or sse (one-way). */
    streamTransport?: StreamTransportMode;
    bearerToken?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
}
/** How live stream events are delivered from causet-realtime. */
export type StreamTransportMode = 'websocket' | 'sse';
export interface StreamConnectOptions {
    /** Override client default stream transport for this connection. */
    transport?: StreamTransportMode;
    /**
     * Ledger replay cursor. Omit to start at 0 (full replay).
     * Pass `-1` for live-only (skip history). Pass `> 0` to resume.
     */
    fromCursor?: number;
    channels?: StreamChannel[];
}
export interface StreamChannel {
    channel: string;
    from_cursor?: number;
}
//# sourceMappingURL=types.d.ts.map