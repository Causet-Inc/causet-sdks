import type { CausetHttpConfig, SseEvent } from './types.js';
export type SseHandler = (event: SseEvent) => void;
/** Parse SSE text chunks into discrete events. */
export declare function parseSseChunk(buffer: string): {
    events: SseEvent[];
    remainder: string;
};
/** Stream intent submission progress via SSE (POST .../intents/submit). */
export declare function submitIntentStream(cfg: CausetHttpConfig, body: Record<string, unknown>, onEvent: SseHandler, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<void>;
/** Browser EventSource helper when GET SSE endpoints are available. */
export declare function openEventSource(url: string, onEvent: SseHandler, onError?: (err: Event) => void): EventSource;
//# sourceMappingURL=transport-sse.d.ts.map