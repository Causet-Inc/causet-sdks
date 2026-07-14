import { describe, expect, it, vi } from 'vitest';
import { parseSseChunk, submitIntentStream, openEventSource } from '../transport-sse.js';
import { CFG, STREAM_URL, createMockFetch } from './helpers.js';
describe('parseSseChunk', () => {
    it('handles empty buffer', () => {
        const { events, remainder } = parseSseChunk('');
        expect(events).toEqual([]);
        expect(remainder).toBe('');
    });
    it('parses single JSON event', () => {
        const block = 'id: evt-1\nevent: progress\ndata: {"step": 1}\n\n';
        const { events, remainder } = parseSseChunk(block);
        expect(events).toHaveLength(1);
        expect(events[0].id).toBe('evt-1');
        expect(events[0].event).toBe('progress');
        expect(events[0].data).toEqual({ step: 1 });
        expect(remainder).toBe('');
    });
    it('parses multiple events', () => {
        const buffer = 'data: {"a": 1}\n\nid: 2\ndata: {"b": 2}\n\n';
        const { events, remainder } = parseSseChunk(buffer);
        expect(events).toHaveLength(2);
        expect(events[0].data).toEqual({ a: 1 });
        expect(events[1].id).toBe('2');
        expect(events[1].data).toEqual({ b: 2 });
        expect(remainder).toBe('');
    });
    it('keeps incomplete block in remainder', () => {
        const buffer = 'data: {"done": true}\n\nid: partial\ndata: {"x"';
        const { events, remainder } = parseSseChunk(buffer);
        expect(events).toHaveLength(1);
        expect(events[0].data).toEqual({ done: true });
        expect(remainder).toBe('id: partial\ndata: {"x"');
    });
    it('preserves non-JSON data as string', () => {
        const { events } = parseSseChunk('data: not-json\n\n');
        expect(events[0].data).toBe('not-json');
    });
    it('joins multiline data', () => {
        const { events } = parseSseChunk('data: line1\ndata: line2\n\n');
        expect(events[0].data).toBe('line1\nline2');
    });
    it('skips empty blocks', () => {
        const { events, remainder } = parseSseChunk('\n\n\n\n');
        expect(events).toEqual([]);
        expect(remainder).toBe('');
    });
    it('handles empty blocks array from split', () => {
        vi.spyOn(String.prototype, 'split').mockReturnValueOnce([]);
        const { events, remainder } = parseSseChunk('test');
        expect(events).toEqual([]);
        expect(remainder).toBe('');
        vi.restoreAllMocks();
    });
    it('skips blocks without data lines', () => {
        const { events } = parseSseChunk('id: only-id\nevent: ping\n\n');
        expect(events).toEqual([]);
    });
    it('skips whitespace-only blocks', () => {
        const { events } = parseSseChunk('   \n\n');
        expect(events).toEqual([]);
    });
});
describe('submitIntentStream', () => {
    it('streams SSE events to callback', async () => {
        const sseBody = 'event: started\ndata: {"phase":"start"}\n\n' +
            'event: done\ndata: {"phase":"complete"}\n\n';
        const received = [];
        let capturedInit;
        const fetchImpl = createMockFetch([
            (url, init) => {
                if (init?.method === 'POST' && url.startsWith(STREAM_URL)) {
                    capturedInit = init;
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode(sseBody));
                            controller.close();
                        },
                    });
                    return new Response(stream, {
                        status: 200,
                        headers: { 'Content-Type': 'text/event-stream' },
                    });
                }
                return null;
            },
        ]);
        await submitIntentStream(CFG, { forkId: 'main', streamId: 's', entityId: 'e', intentType: 'T', payload: {} }, (ev) => received.push(ev), fetchImpl);
        expect(received).toHaveLength(2);
        expect(received[0].event).toBe('started');
        expect(received[0].data).toEqual({ phase: 'start' });
        expect(received[1].data).toEqual({ phase: 'complete' });
        expect(capturedInit.headers.Authorization).toBe('Bearer jwt-test');
        expect(capturedInit.headers.Accept).toBe('text/event-stream');
        expect(JSON.parse(capturedInit.body).intentType).toBe('T');
    });
    it('throws on HTTP error', async () => {
        const fetchImpl = createMockFetch([
            (url, init) => {
                if (init?.method === 'POST' && url.startsWith(STREAM_URL)) {
                    return new Response(null, { status: 500 });
                }
                return null;
            },
        ]);
        await expect(submitIntentStream(CFG, {}, () => undefined, fetchImpl)).rejects.toThrow('SSE intent submit failed: 500');
    });
    it('throws when response body is missing', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: null }));
        await expect(submitIntentStream(CFG, {}, () => undefined, fetchImpl)).rejects.toThrow('SSE intent submit failed: 200');
    });
    it('works without bearer token', async () => {
        const fetchImpl = createMockFetch([
            (url, init) => {
                if (init?.method === 'POST' && url.startsWith(STREAM_URL)) {
                    expect(init.headers.Authorization).toBeUndefined();
                    const stream = new ReadableStream({
                        start(c) {
                            c.close();
                        },
                    });
                    return new Response(stream, { status: 200 });
                }
                return null;
            },
        ]);
        await submitIntentStream({ ...CFG, bearerToken: undefined }, {}, () => undefined, fetchImpl);
    });
});
describe('openEventSource', () => {
    it('parses JSON message data and forwards to handler', () => {
        const handlers = [];
        class MockEventSource {
            url;
            onmessage = null;
            onerror = null;
            constructor(url) {
                this.url = url;
                handlers.push(this);
            }
        }
        vi.stubGlobal('EventSource', MockEventSource);
        const received = [];
        const es = openEventSource('http://example.com/sse', (ev) => received.push(ev));
        handlers[0].onmessage?.({ data: '{"x":1}', lastEventId: '1', type: 'update' });
        expect(received[0]).toEqual({ id: '1', event: 'update', data: { x: 1 } });
        expect(es.url).toBe('http://example.com/sse');
        vi.unstubAllGlobals();
    });
    it('keeps non-JSON data as string', () => {
        const handlers = [];
        class MockEventSource {
            onmessage = null;
            onerror = null;
            constructor(_url) {
                handlers.push(this);
            }
        }
        vi.stubGlobal('EventSource', MockEventSource);
        const received = [];
        openEventSource('http://example.com/sse', (ev) => received.push(ev));
        handlers[0].onmessage?.({ data: 'plain', lastEventId: '', type: 'message' });
        expect(received[0]).toEqual({ id: '', event: 'message', data: 'plain' });
        vi.unstubAllGlobals();
    });
    it('forwards errors to onError callback', () => {
        const handlers = [];
        class MockEventSource {
            onmessage = null;
            onerror = null;
            constructor(_url) {
                handlers.push(this);
            }
        }
        vi.stubGlobal('EventSource', MockEventSource);
        const errors = [];
        openEventSource('http://example.com/sse', () => undefined, (e) => errors.push(e));
        const errEvent = new Event('error');
        handlers[0].onerror?.(errEvent);
        expect(errors[0]).toBe(errEvent);
        vi.unstubAllGlobals();
    });
});
