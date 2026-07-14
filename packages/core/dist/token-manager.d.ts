export declare class ApiKeyTokenManager {
    private readonly apiUrl;
    private readonly apiKey;
    private readonly fetchImpl;
    private token;
    private expiresAt;
    private inflight;
    private refreshTimer;
    constructor(apiUrl: string, apiKey: string, fetchImpl?: typeof fetch);
    getToken(): Promise<string>;
    init(): Promise<void>;
    forceRefresh(): Promise<string>;
    destroy(): void;
    private destroyTimers;
    private exchange;
    private scheduleRefresh;
}
export declare function orgIdFromToken(token: string): string | null;
/** @deprecated Import from realtime.js */
export declare function deriveWsUrl(apiUrl: string): string;
//# sourceMappingURL=token-manager.d.ts.map