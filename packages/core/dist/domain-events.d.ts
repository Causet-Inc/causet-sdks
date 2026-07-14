/**
 * Extract business event types from a realtime SSE / WebSocket envelope.
 * Causet may surface domain emits as top-level event_type, emits[], or patch ops.
 */
export interface DomainStreamEvent {
    type: string;
    entity: string;
    payload: Record<string, unknown>;
}
/**
 * Normalize a stream envelope (SSE data object or WebSocket event) into domain events.
 */
export declare function extractDomainEvents(event: Record<string, unknown>, sseEventName?: string): DomainStreamEvent[];
//# sourceMappingURL=domain-events.d.ts.map