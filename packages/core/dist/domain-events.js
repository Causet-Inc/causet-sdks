/**
 * Extract business event types from a realtime SSE / WebSocket envelope.
 * Causet may surface domain emits as top-level event_type, emits[], or patch ops.
 */
function isInternalEventType(type) {
    const t = String(type || '');
    return (!t ||
        t === 'message' ||
        t === 'event' ||
        t === 'STATE_PATCH' ||
        t === 'STATE_EMIT' ||
        t === '__bootstrap__' ||
        t.startsWith('REJECTED:'));
}
function pushDomain(out, seen, type, entity, payload) {
    const t = String(type || '').trim();
    if (isInternalEventType(t))
        return;
    const ent = String(entity || '');
    const key = `${t}|${ent}`;
    if (seen.has(key))
        return;
    seen.add(key);
    out.push({ type: t, entity: ent, payload });
}
/**
 * Normalize a stream envelope (SSE data object or WebSocket event) into domain events.
 */
export function extractDomainEvents(event, sseEventName) {
    const out = [];
    const seen = new Set();
    const top = sseEventName ||
        event.event_type ||
        event.eventType ||
        '';
    const entity = event.entity_id ||
        event.entityId ||
        '';
    const emits = Array.isArray(event.emits) ? event.emits : [];
    const patch = Array.isArray(event.patch) ? event.patch : [];
    if (!isInternalEventType(String(top))) {
        const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
            ? event.payload
            : event;
        pushDomain(out, seen, top, entity, payload);
    }
    for (const em of emits) {
        if (!em || typeof em !== 'object')
            continue;
        const row = em;
        const et = row.event_type || row.eventType || '';
        const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
            ? row.payload
            : row;
        pushDomain(out, seen, et, row.entity_id ||
            row.entityId ||
            entity ||
            payload.transfer_id ||
            '', payload);
    }
    for (const op of patch) {
        if (!op || typeof op !== 'object')
            continue;
        const row = op;
        // Envelope status strings (PREPARING / COMMITTING / COMMITTED) are state,
        // not domain emits — do not promote them or UIs double-log "commit".
        const v = row.value;
        if (!v || typeof v !== 'object' || Array.isArray(v))
            continue;
        const val = v;
        const et = val.eventType || val.event_type || '';
        if (et) {
            const payload = val.payload && typeof val.payload === 'object' && !Array.isArray(val.payload)
                ? val.payload
                : val;
            pushDomain(out, seen, et, entity || payload.transfer_id || val.transfer_id || '', payload);
        }
    }
    return out;
}
