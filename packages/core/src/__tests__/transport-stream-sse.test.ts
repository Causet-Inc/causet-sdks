import { describe, expect, it, vi } from 'vitest';
import { CausetTransportStreamSse } from '../transport-stream-sse.js';
import { createMockFetch, textResponse } from './helpers.js';

describe('CausetTransportStreamSse', () => {
  it('connects without token (local open) and disconnects', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url).toContain('from_cursor=-1');
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: message\ndata: {"x":1}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    ]);
    const events: unknown[] = [];
    const t = new CausetTransportStreamSse({
      realtimeUrl: 'http://localhost:8081',
      cfg: { apiUrl: 'http://localhost:8085', platformSlug: 'p', appSlug: 'a', platformId: 'pid', applicationId: 'aid' },
      streamId: 'wallet_stream',
      fromCursor: -1,
      fetchImpl,
      onEvent: (e) => events.push(e),
    });
    await t.connect();
    expect(t.isConnected).toBe(true);
    await vi.waitFor(() => expect(events.length).toBe(1));
    t.disconnect();
    expect(t.isConnected).toBe(false);
  });

  it('throws on non-ok response', async () => {
    const fetchImpl = createMockFetch([() => textResponse('nope', 500)]);
    const t = new CausetTransportStreamSse({
      realtimeUrl: 'http://localhost:8081',
      cfg: { apiUrl: 'http://localhost:8085', platformSlug: 'p', appSlug: 'a', bearerToken: 't' },
      streamId: 's',
      fetchImpl,
    });
    await expect(t.connect()).rejects.toThrow(/failed: 500/);
  });

  it('ignores abort errors on disconnect during read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchImpl = createMockFetch([
      () => {
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"x":1}\n\n'));
            await gate;
            try {
              controller.close();
            } catch { /* already aborted */ }
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    ]);
    const errors: unknown[] = [];
    const t = new CausetTransportStreamSse({
      realtimeUrl: 'http://localhost:8081',
      cfg: { apiUrl: 'http://localhost:8085', platformSlug: 'p', appSlug: 'a', bearerToken: 't' },
      streamId: 's',
      fetchImpl,
      onError: (e) => errors.push(e),
    });
    await t.connect();
    t.disconnect();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toHaveLength(0);
  });
});
