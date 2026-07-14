/**
 * Extract business event types from a realtime SSE / WebSocket envelope.
 * Causet may surface domain emits as top-level event_type, emits[], or patch ops.
 */

export interface DomainStreamEvent {
  type: string;
  entity: string;
  payload: Record<string, unknown>;
}

function isInternalEventType(type: string): boolean {
  const t = String(type || '');
  return (
    !t ||
    t === 'message' ||
    t === 'event' ||
    t === 'STATE_PATCH' ||
    t === 'STATE_EMIT' ||
    t === '__bootstrap__' ||
    t.startsWith('REJECTED:')
  );
}

function pushDomain(
  out: DomainStreamEvent[],
  seen: Set<string>,
  type: unknown,
  entity: unknown,
  payload: Record<string, unknown>,
): void {
  const t = String(type || '').trim();
  if (isInternalEventType(t)) return;
  const ent = String(entity || '');
  const key = `${t}|${ent}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ type: t, entity: ent, payload });
}

/**
 * Normalize a stream envelope (SSE data object or WebSocket event) into domain events.
 */
export function extractDomainEvents(
  event: Record<string, unknown>,
  sseEventName?: string,
): DomainStreamEvent[] {
  const out: DomainStreamEvent[] = [];
  const seen = new Set<string>();
  const top =
    sseEventName ||
    (event.event_type as string | undefined) ||
    (event.eventType as string | undefined) ||
    '';
  const entity =
    (event.entity_id as string | undefined) ||
    (event.entityId as string | undefined) ||
    '';
  const emits = Array.isArray(event.emits) ? event.emits : [];
  const patch = Array.isArray(event.patch) ? event.patch : [];

  if (!isInternalEventType(String(top))) {
    const payload =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : event;
    pushDomain(out, seen, top, entity, payload);
  }

  for (const em of emits) {
    if (!em || typeof em !== 'object') continue;
    const row = em as Record<string, unknown>;
    const et = row.event_type || row.eventType || '';
    const payload =
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : row;
    pushDomain(
      out,
      seen,
      et,
      row.entity_id ||
        row.entityId ||
        entity ||
        (payload.transfer_id as string | undefined) ||
        '',
      payload,
    );
  }

  for (const op of patch) {
    if (!op || typeof op !== 'object') continue;
    const row = op as Record<string, unknown>;
    // Envelope status strings (PREPARING / COMMITTING / COMMITTED) are state,
    // not domain emits — do not promote them or UIs double-log "commit".
    const v = row.value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const val = v as Record<string, unknown>;
    const et = val.eventType || val.event_type || '';
    if (et) {
      const payload =
        val.payload && typeof val.payload === 'object' && !Array.isArray(val.payload)
          ? (val.payload as Record<string, unknown>)
          : val;
      pushDomain(
        out,
        seen,
        et,
        entity || (payload.transfer_id as string | undefined) || (val.transfer_id as string | undefined) || '',
        payload,
      );
    }
  }

  return out;
}
