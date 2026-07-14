import { describe, expect, it } from 'vitest';
import { extractDomainEvents } from '../domain-events.js';

describe('extractDomainEvents', () => {
  it('extracts top-level event_type', () => {
    const events = extractDomainEvents({
      event_type: 'WALLET_FUNDED',
      entity_id: 'wallet-1',
      payload: { amount: 100 },
    });
    expect(events).toEqual([
      { type: 'WALLET_FUNDED', entity: 'wallet-1', payload: { amount: 100 } },
    ]);
  });

  it('extracts emits[] and ignores internal types', () => {
    const events = extractDomainEvents({
      event_type: 'STATE_PATCH',
      entity_id: 'xfer-1',
      emits: [
        null,
        { event_type: 'TRANSFER_COMMIT', entity_id: 'xfer-1', payload: { amount: 5 } },
        { eventType: 'OTHER', payload: { transfer_id: 't2' } },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['TRANSFER_COMMIT', 'OTHER']);
  });

  it('uses payload.transfer_id when emit has no entity', () => {
    const events = extractDomainEvents({
      emits: [
        { event_type: 'VIA_PAYLOAD', payload: { transfer_id: 't3' } },
        { event_type: 'NO_ENTITY', payload: {} },
      ],
    });
    expect(events[0]).toMatchObject({ type: 'VIA_PAYLOAD', entity: 't3' });
    expect(events[1]).toMatchObject({ type: 'NO_ENTITY', entity: '' });
  });

  it('does not treat envelope status patches as domain events', () => {
    const events = extractDomainEvents({
      entity_id: 'xfer-1',
      patch: [
        { path: '/envelope/status', value: 'COMMITTING' },
        { path: '/transfer/envelope/status', value: 'COMMITTED' },
        { path: null, value: { eventType: 'TRANSFER_COMMIT', payload: { amount: 1 } } },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['TRANSFER_COMMIT']);
  });

  it('extracts eventType from patch op values', () => {
    const events = extractDomainEvents({
      entity_id: 'w1',
      patch: [
        null,
        { path: '/x', value: 1 },
        { path: null, value: { eventType: 'WALLET_OPENED', payload: { owner: 'a' } } },
        { path: null, value: { event_type: 'WALLET_FUNDED', transfer_id: 'm1' } },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['WALLET_OPENED', 'WALLET_FUNDED']);
  });

  it('uses sseEventName override', () => {
    const events = extractDomainEvents({ entity_id: 'w1' }, 'WALLET_OPENED');
    expect(events[0].type).toBe('WALLET_OPENED');
  });
});
