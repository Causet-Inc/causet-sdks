import { describe, expect, it, vi } from 'vitest';
import { CausetTransportWebSocket } from '../transport-ws.js';
function createMockWebSocketClass() {
    const instances = [];
    class MockWebSocket {
        url;
        sent = [];
        onopen = null;
        onmessage = null;
        onerror = null;
        onclose = null;
        constructor(url, _protocols) {
            this.url = url;
            instances.push(this);
            queueMicrotask(() => this.onopen?.());
        }
        send(data) {
            this.sent.push(data);
        }
        close() {
            this.onclose?.();
        }
        /** Test helper — simulate server welcome after hello. */
        simulateWelcome(connId = 'conn-1') {
            this.onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: connId }) });
        }
        simulateMessage(data) {
            this.onmessage?.({ data: JSON.stringify(data) });
        }
        simulateError(err) {
            this.onerror?.(err);
        }
    }
    return { MockWebSocket, instances };
}
describe('CausetTransportWebSocket buildUrl', () => {
    it('includes api_key when set', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            apiKey: 'ck_live_test',
        });
        const url = t.buildUrl();
        expect(url).toContain('api_key=ck_live_test');
        expect(url).not.toContain('token=');
    });
    it('includes token when bearer set', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            bearerToken: 'jwt-abc',
        });
        const url = t.buildUrl();
        expect(url).toContain('token=jwt-abc');
        expect(url).not.toContain('api_key=');
    });
    it('includes both api_key and token when both set', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            apiKey: 'ck_live_test',
            bearerToken: 'jwt-abc',
        });
        const url = t.buildUrl();
        expect(url).toContain('api_key=ck_live_test');
        expect(url).toContain('token=jwt-abc');
    });
});
describe('CausetTransportWebSocket buildHello', () => {
    it('builds hello message shape', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
        });
        const hello = t.buildHello();
        expect(hello.type).toBe('hello');
        expect(hello.v).toBe(1);
        expect(hello.project_id).toBe('org1');
        expect(hello.env).toBe('prod');
        expect(hello.stream_id).toBe('orders');
        expect(Array.isArray(hello.subs)).toBe(true);
        expect(hello.sdk.name).toBe('causet-sdk-js');
    });
    it('applies fromCursor to default channels', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            fromCursor: 42,
        });
        const hello = t.buildHello();
        for (const sub of hello.subs) {
            expect(sub.from_cursor).toBe(42);
        }
    });
    it('does not override existing from_cursor on channel', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            fromCursor: 42,
            channels: [{ channel: 'ledger', from_cursor: 10 }],
        });
        const hello = t.buildHello();
        expect(hello.subs[0].from_cursor).toBe(10);
    });
    it('uses default ledger and state channels', () => {
        const t = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
        });
        const hello = t.buildHello();
        const channels = hello.subs.map((s) => s.channel);
        expect(channels).toContain('ledger');
        expect(channels).toContain('state');
    });
});
describe('CausetTransportWebSocket connect', () => {
    it('connects, sends hello, resolves on welcome', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const onWelcome = vi.fn();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            bearerToken: 'jwt',
            WebSocketImpl: MockWebSocket,
            onWelcome,
        });
        const connectPromise = transport.connect();
        await vi.waitFor(() => expect(instances[0].sent.length).toBe(1));
        const hello = JSON.parse(instances[0].sent[0]);
        expect(hello.type).toBe('hello');
        instances[0].simulateWelcome('conn-99');
        const connId = await connectPromise;
        expect(connId).toBe('conn-99');
        expect(transport.isConnected).toBe(true);
        expect(transport.connId).toBe('conn-99');
        expect(onWelcome).toHaveBeenCalledWith('conn-99');
    });
    it('forwards non-welcome events to onEvent', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const onEvent = vi.fn();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            WebSocketImpl: MockWebSocket,
            onEvent,
        });
        void transport.connect();
        await vi.waitFor(() => expect(instances[0].sent.length).toBe(1));
        instances[0].simulateWelcome();
        instances[0].simulateMessage({ type: 'patch', entity_id: 'e1' });
        expect(onEvent).toHaveBeenCalledWith({ type: 'patch', entity_id: 'e1' });
    });
    it('forwards error type messages to onError', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const onError = vi.fn();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            WebSocketImpl: MockWebSocket,
            onError,
        });
        void transport.connect();
        await vi.waitFor(() => expect(instances[0].sent.length).toBe(1));
        instances[0].simulateWelcome();
        instances[0].simulateMessage({ type: 'error', message: 'bad' });
        expect(onError).toHaveBeenCalledWith({ type: 'error', message: 'bad' });
    });
    it('handles invalid JSON via onError', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const onError = vi.fn();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            WebSocketImpl: MockWebSocket,
            onError,
        });
        void transport.connect();
        await vi.waitFor(() => expect(instances[0].sent.length).toBe(1));
        instances[0].simulateWelcome();
        instances[0].onmessage?.({ data: 'not-json' });
        expect(onError).toHaveBeenCalled();
    });
    it('rejects on WebSocket error before welcome', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const onError = vi.fn();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            WebSocketImpl: MockWebSocket,
            onError,
        });
        const connectPromise = transport.connect();
        await vi.waitFor(() => expect(instances.length).toBe(1));
        const err = new Event('error');
        instances[0].simulateError(err);
        await expect(connectPromise).rejects.toBe(err);
        expect(onError).toHaveBeenCalledWith(err);
    });
    it('calls onClose and clears isConnected on disconnect', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const onClose = vi.fn();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            WebSocketImpl: MockWebSocket,
            onClose,
        });
        void transport.connect();
        await vi.waitFor(() => expect(instances[0].sent.length).toBe(1));
        instances[0].simulateWelcome();
        transport.disconnect();
        expect(onClose).toHaveBeenCalled();
        expect(transport.isConnected).toBe(false);
    });
    it('welcome with missing conn_id resolves null', async () => {
        const { MockWebSocket, instances } = createMockWebSocketClass();
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
            WebSocketImpl: MockWebSocket,
        });
        const connectPromise = transport.connect();
        await vi.waitFor(() => expect(instances[0].sent.length).toBe(1));
        instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome' }) });
        expect(await connectPromise).toBeNull();
    });
    it('disconnect is safe when not connected', () => {
        const transport = new CausetTransportWebSocket({
            wsUrl: 'wss://api.example.com/ws',
            projectId: 'org1',
            env: 'prod',
            streamId: 'orders',
        });
        transport.disconnect();
        expect(transport.isConnected).toBe(false);
    });
});
