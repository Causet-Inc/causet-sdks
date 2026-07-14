export declare const BASE = "https://api.causet.cloud";
export declare const PREFIX = "https://api.causet.cloud/v1/platforms/org1/applications/app1";
export declare const RUNTIME_PREFIX = "https://api.causet.cloud/v1/runtime/platforms/org1/applications/app1";
export declare const STREAM_URL = "https://api.causet.cloud/v1/runtime/stream/platforms/org1/applications/app1/intents/submit";
export declare const CFG: {
    apiUrl: string;
    platformSlug: string;
    appSlug: string;
    forkId: string;
    bearerToken: string;
};
export declare const CFG_NO_FORK: {
    apiUrl: string;
    platformSlug: string;
    appSlug: string;
    bearerToken: string;
};
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
export declare function createMockFetch(handlers: FetchHandler[]): typeof fetch;
export declare function jsonResponse(body: unknown, status?: number, statusText?: string): Response;
export declare function textResponse(text: string, status?: number, headers?: Record<string, string>): Response;
export declare function emptyResponse(status?: number): Response;
/** JWT payload with org_id for WebSocket project_id resolution. */
export declare function jwtWithOrgId(orgId: string): string;
export {};
//# sourceMappingURL=helpers.d.ts.map