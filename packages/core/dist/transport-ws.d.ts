import type { StreamChannel } from './types.js';
export interface WebSocketTransportOptions {
    wsUrl: string;
    streamId: string;
    forkId?: string;
    /** @deprecated Tenant context is derived from the JWT; not sent in hello. */
    projectId?: string;
    /** @deprecated Use forkId instead. */
    env?: string;
    bearerToken?: string;
    apiKey?: string;
    channels?: StreamChannel[];
    fromCursor?: number;
    onEvent?: (event: Record<string, unknown>) => void;
    onWelcome?: (connId: string | null) => void;
    onError?: (err: unknown) => void;
    onClose?: () => void;
    WebSocketImpl?: typeof WebSocket;
}
export declare class CausetTransportWebSocket {
    private readonly opts;
    private ws;
    connId: string | null;
    isConnected: boolean;
    constructor(opts: WebSocketTransportOptions);
    connect(): Promise<string | null>;
    disconnect(): void;
    private buildUrl;
    private buildHello;
}
//# sourceMappingURL=transport-ws.d.ts.map