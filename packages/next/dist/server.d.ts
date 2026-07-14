import { CausetClient } from '@causet/sdk-core';
export interface CausetEnvConfig {
    apiUrl?: string;
    platformSlug?: string;
    appSlug?: string;
    forkId?: string;
    apiKey?: string;
    bearerToken?: string;
}
/** Create a server-side client from environment variables. */
export declare function createServerCausetClient(overrides?: CausetEnvConfig): CausetClient;
export declare function serverEmitIntent(streamId: string, entityId: string, intentType: string, payload: Record<string, unknown>, config?: CausetEnvConfig): Promise<import("@causet/sdk-core").IntentResult>;
export declare function serverRunQuery(querySlug: string, input?: Record<string, unknown> | null, config?: CausetEnvConfig & {
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}): Promise<import("@causet/sdk-core").QueryResult>;
