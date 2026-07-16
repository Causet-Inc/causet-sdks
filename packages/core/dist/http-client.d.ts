import type { CausetHttpConfig, IntentResult, QueryResult } from './types.js';
export declare function fetchState(cfg: CausetHttpConfig, streamId: string, entityId: string, fetchImpl?: typeof fetch): Promise<{
    state: unknown;
    cursor: number;
}>;
export declare function submitIntent(cfg: CausetHttpConfig, streamId: string, entityId: string, intentType: string, payload: Record<string, unknown>, intentId?: string, fetchImpl?: typeof fetch): Promise<IntentResult>;
export declare function runQuery(cfg: CausetHttpConfig, querySlug: string, input: Record<string, unknown> | null | undefined, opts?: {
    limit?: number;
    offset?: number;
    cursor?: string;
    includeTotal?: boolean;
    fetchImpl?: typeof fetch;
}): Promise<QueryResult>;
export declare function listQueries(cfg: CausetHttpConfig, fetchImpl?: typeof fetch): Promise<unknown>;
export declare function getQueryDefinition(cfg: CausetHttpConfig, querySlug: string, fetchImpl?: typeof fetch): Promise<Record<string, unknown>>;
export declare function listProjections(cfg: CausetHttpConfig, fetchImpl?: typeof fetch): Promise<unknown>;
export declare function listEntities(cfg: CausetHttpConfig, opts?: {
    streamName?: string;
    searchPrefix?: string;
    cursor?: string;
    limit?: number;
    fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>>;
//# sourceMappingURL=http-client.d.ts.map