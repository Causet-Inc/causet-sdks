import type { CausetHttpConfig } from './types.js';
export interface StreamSseTransportOptions {
    realtimeUrl: string;
    cfg: CausetHttpConfig;
    streamId: string;
    forkId?: string;
    fromCursor?: number;
    apiKey?: string;
    onEvent?: (event: Record<string, unknown>) => void;
    onConnected?: () => void;
    onError?: (err: unknown) => void;
    onClose?: () => void;
    fetchImpl?: typeof fetch;
}
/** SSE transport for causet-realtime stream events (replay + live). */
export declare class CausetTransportStreamSse {
    private readonly opts;
    private abort;
    isConnected: boolean;
    connId: string | null;
    constructor(opts: StreamSseTransportOptions);
    connect(): Promise<string | null>;
    private readLoop;
    disconnect(): void;
}
//# sourceMappingURL=transport-stream-sse.d.ts.map