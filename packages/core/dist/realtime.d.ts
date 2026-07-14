import type { CausetHttpConfig } from './types.js';
/** How live stream events are delivered from causet-realtime. */
export type StreamTransportMode = 'websocket' | 'sse';
export interface StreamEventsUrlOptions {
    streamId: string;
    forkId?: string;
    fromCursor?: number;
    token?: string;
    apiKey?: string;
}
/**
 * HTTP base URL for causet-realtime (SSE).
 * Maps API URLs to the dedicated realtime service — not the SaaS API host.
 */
export declare function deriveRealtimeUrl(apiUrl: string): string;
/** WebSocket URL from causet-realtime HTTP base. */
export declare function deriveWsUrlFromRealtime(realtimeUrl: string): string;
/** WebSocket URL derived from API URL. */
export declare function deriveWsUrl(apiUrl: string): string;
/**
 * Canonical SSE stream events endpoint:
 * GET /v1/platforms/{platformId}/applications/{applicationId}/streams/{streamId}/events
 *
 * Prefer resolved UUIDs (`platformId` / `applicationId`) — hub fanout matches event
 * platform/application ids, not slugs. Slugs are a fallback for hosted JWTs that
 * already embed the same identifiers.
 */
export declare function buildStreamEventsUrl(realtimeUrl: string, cfg: CausetHttpConfig, opts: StreamEventsUrlOptions): string;
//# sourceMappingURL=realtime.d.ts.map