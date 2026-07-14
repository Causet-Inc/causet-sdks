import { type ReactNode } from 'react';
import { CausetClient, type CausetClientOptions, type QueryResult } from '@causet/sdk-core';
export interface CausetProviderProps {
    options: CausetClientOptions;
    children: ReactNode;
}
/** Client-side provider — mount once in a client component tree. */
export declare function CausetProvider({ options, children }: CausetProviderProps): import("react").JSX.Element;
export declare function useCausetClient(): CausetClient;
export declare function useCausetQuery(querySlug: string, input?: Record<string, unknown> | null, opts?: {
    limit?: number;
    includeTotal?: boolean;
}): {
    data: QueryResult | null;
    error: unknown;
    loading: boolean;
    refresh: () => Promise<void>;
};
export declare function useCausetIntent(): {
    emit: (streamId: string, entityId: string, intentType: string, payload: Record<string, unknown>) => Promise<import("@causet/sdk-core").IntentResult>;
    emitStream: (streamId: string, entityId: string, intentType: string, payload: Record<string, unknown>, onEvent: Parameters<CausetClient["emitStream"]>[4]) => Promise<void>;
    pending: boolean;
};
/** Subscribe to entity state + optional WebSocket stream. */
export declare function useCausetEntity(streamId: string, entityId: string, connectWs?: boolean): Record<string, unknown> | null;
export { CausetClient, type CausetClientOptions, type QueryResult };
