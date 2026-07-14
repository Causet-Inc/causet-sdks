import type { CausetClientOptions, IntentResult, QueryResult, SseEvent, StreamConnectOptions, StreamTransportMode } from './types.js';
export declare class CausetClient {
    private readonly fetchImpl;
    private tokenManager;
    private subscriptions;
    private emitter;
    private selectors;
    /** Active live transports keyed by stream id (supports multi-stream SSE/WS). */
    private streamTransports;
    readonly apiUrl: string;
    readonly platformSlug: string;
    readonly appSlug: string;
    readonly forkId: string;
    readonly wsUrl: string;
    readonly realtimeUrl: string;
    readonly streamTransportMode: StreamTransportMode;
    private bearerToken;
    readonly apiKey: string;
    platformId: string;
    applicationId: string;
    constructor(options: CausetClientOptions);
    private getToken;
    getTokenPublic(): Promise<string>;
    private httpConfig;
    private runWithRetry;
    init(): Promise<void>;
    destroy(): void;
    on(eventType: string, handler: (data: unknown) => void): () => void;
    /**
     * Resolve platform/app slugs → UUIDs via CLI catalog endpoints.
     * Required for realtime SSE hub matching on local/open deployments.
     */
    resolveIds(): Promise<{
        platformId: string;
        applicationId: string;
    }>;
    subscribe(streamId: string, entityId: string): Promise<void>;
    unsubscribe(streamId: string, entityId: string): void;
    getState(streamId: string, entityId: string): Record<string, unknown> | null;
    emit(streamId: string, entityId: string, intentType: string, payload: Record<string, unknown>, intentId?: string): Promise<IntentResult>;
    /** Submit intent and stream SSE progress events (START, COMPLETE, ERROR, …). */
    emitStream(streamId: string, entityId: string, intentType: string, payload: Record<string, unknown>, onEvent: (event: SseEvent) => void, intentId?: string, signal?: AbortSignal): Promise<void>;
    runQuery(querySlug: string, input?: Record<string, unknown> | null, opts?: {
        limit?: number;
        offset?: number;
        cursor?: string;
        includeTotal?: boolean;
    }): Promise<QueryResult>;
    listQueries(): Promise<unknown>;
    getQueryDefinition(querySlug: string): Promise<Record<string, unknown>>;
    listProjections(): Promise<unknown>;
    listEntities(opts?: {
        streamName?: string;
        searchPrefix?: string;
        cursor?: string;
        limit?: number;
    }): Promise<Record<string, unknown>>;
    fetchState(streamId: string, entityId: string): Promise<{
        state: unknown;
        cursor: number;
    }>;
    /**
     * Connect a live stream (WebSocket or SSE). Replaces any prior connection for the
     * same streamId; other streams stay open (use connectStreams for several at once).
     */
    connectStream(streamId: string, opts?: StreamConnectOptions): Promise<string | null>;
    /** Connect several live streams with the same options (e.g. wallet + transfer). */
    connectStreams(streamIds: string[], opts?: StreamConnectOptions): Promise<(string | null)[]>;
    /** Disconnect one stream, or all when streamId is omitted. */
    disconnectStream(streamId?: string): void;
    /** Whether any (or a specific) live stream transport is registered. */
    isStreamConnected(streamId?: string): boolean;
    select(streamId: string, entityId: string, selector: (state: Record<string, unknown>) => unknown, handler: (value: unknown) => void): () => void;
    private refreshSubscriptionAfterIntent;
    private handleStreamEvent;
    private notifySelectors;
}
//# sourceMappingURL=client.d.ts.map