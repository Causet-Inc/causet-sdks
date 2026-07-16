import { afterEach, describe, expect, it, vi } from 'vitest';
import { CausetApiError, CausetError } from '../errors.js';
import { CausetClient } from '../client.js';
import { deriveWsUrl } from '../token-manager.js';
import {
  BASE,
  PREFIX,
  RUNTIME_PREFIX,
  STREAM_URL,
  createMockFetch,
  jsonResponse,
  jwtWithOrgId,
} from './helpers.js';

function makeClient(overrides: Partial<ConstructorParameters<typeof CausetClient>[0]> = {}) {
  return new CausetClient({
    apiUrl: BASE,
    platformSlug: 'org1',
    appSlug: 'app1',
    bearerToken: 'jwt-test',
    ...overrides,
  });
}

describe('CausetClient wsUrl', () => {
  it('derives wss from https apiUrl', () => {
    const c = makeClient({ apiUrl: 'https://api.example.com' });
    expect(c.wsUrl).toBe('wss://api.example.com/ws');
  });

  it('derives ws from http apiUrl (local runtime → realtime port)', () => {
    const c = makeClient({ apiUrl: 'http://localhost:8085' });
    expect(c.wsUrl).toBe('ws://localhost:8081/ws');
  });

  it('derives sandbox wss from sandbox API URL', () => {
    const c = makeClient({ apiUrl: 'https://sandbox.api.causet.cloud' });
    expect(c.wsUrl).toBe('wss://sandbox.realtime.causet.cloud/ws');
  });

  it('uses explicit wsUrl', () => {
    const c = makeClient({ wsUrl: 'wss://custom.ws/ws' });
    expect(c.wsUrl).toBe('wss://custom.ws/ws');
  });

  it('deriveWsUrl matches client default', () => {
    expect(deriveWsUrl('https://api.example.com')).toBe('wss://api.example.com/ws');
  });
});

describe('CausetClient getTokenPublic', () => {
  it('throws when no apiKey or bearerToken', async () => {
    const client = makeClient({ bearerToken: undefined });
    await expect(client.getTokenPublic()).rejects.toThrow(CausetError);
  });
});

describe('CausetClient subscribe and getState', () => {
  it('subscribe fetches state', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/entities/orders/order-1/state')) {
          return jsonResponse({ snapshotJson: { total: 100 }, snapshotVersion: 5 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('orders', 'order-1');
    expect(client.getState('orders', 'order-1')).toEqual({ total: 100 });
  });

  it('getState returns null when not subscribed', () => {
    expect(makeClient().getState('nope', 'nope')).toBeNull();
  });

  it('subscribe emits state event', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { total: 100 }, snapshotVersion: 5 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const received: unknown[] = [];
    client.on('state', (data) => received.push(data));
    await client.subscribe('orders', 'order-1');
    expect(received).toHaveLength(1);
    expect((received[0] as { state: unknown }).state).toEqual({ total: 100 });
  });

  it('unsubscribe removes state and selectors', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { total: 100, x: 1 }, snapshotVersion: 5 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const values: unknown[] = [];
    await client.subscribe('orders', 'order-1');
    client.select('orders', 'order-1', (s) => s.x, (v) => values.push(v));
    client.unsubscribe('orders', 'order-1');
    expect(client.getState('orders', 'order-1')).toBeNull();
    expect(values).toEqual([1]);
  });

  it('getState returns deep clone', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { items: [1] }, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    const state = client.getState('s', 'e')!;
    state.items.push(999);
    expect(client.getState('s', 'e')).toEqual({ items: [1] });
  });
});

describe('CausetClient submitIntent', () => {
  it('submitIntent and deprecated intent/emit aliases share behavior', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: true, executionId: 'exec-1' });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const viaSubmit = await client.submitIntent('s', 'e', 'T', { x: 1 }, 'id-1');
    const viaIntent = await client.intent('s', 'e', 'T', { x: 2 }, 'id-2');
    const viaEmit = await client.emit('s', 'e', 'T', { x: 3 }, 'id-3');
    expect(viaSubmit.accepted).toBe(true);
    expect(viaIntent.accepted).toBe(true);
    expect(viaEmit.accepted).toBe(true);
  });
});

describe('CausetClient intent', () => {
  it('accepted intent applies statePatch', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            executionId: 'exec-1',
            statePatch: [{ op: 'replace', path: '/x', value: 2 }],
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    const result = await client.intent('s', 'e', 'UPDATE', { x: 2 });
    expect(result.accepted).toBe(true);
    expect(client.getState('s', 'e')).toEqual({ x: 2 });
  });

  it('accepted intent applies string statePatch', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            statePatch: JSON.stringify([{ op: 'replace', path: '/x', value: 3 }]),
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    await client.intent('s', 'e', 'UPDATE', {});
    expect(client.getState('s', 'e')).toEqual({ x: 3 });
  });

  it('accepted intent without patch refetches state', async () => {
    let stateCalls = 0;
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          stateCalls += 1;
          if (stateCalls === 1) {
            return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
          }
          return jsonResponse({ snapshotJson: { x: 99 }, snapshotVersion: 2 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    await client.intent('s', 'e', 'UPDATE', {});
    expect(client.getState('s', 'e')).toEqual({ x: 99 });
    expect(stateCalls).toBe(2);
  });

  it('non-accepted intent throws and does not refresh subscription', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: false, error: 'INSUFFICIENT_FUNDS' });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    await expect(client.intent('s', 'e', 'UPDATE', {})).rejects.toThrow(/INSUFFICIENT_FUNDS/);
    expect(client.getState('s', 'e')).toEqual({ x: 1 });
  });

  it('non-accepted intent without error uses default message', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: false });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await expect(client.intent('s', 'e', 'FOO', {})).rejects.toThrow(/FOO was not accepted/);
  });

  it('non-accepted intent throws rejection message', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: false,
            rejectionCode: 'SAME_WALLET',
            rejectionMessage: 'Cannot transfer to the same wallet',
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await expect(client.intent('s', 'e', 'TRANSFER_START', {})).rejects.toThrow(
      /SAME_WALLET: Cannot transfer to the same wallet/,
    );
  });

  it('intent with intentId', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          const body = JSON.parse(init.body as string);
          expect(body.intentId).toBe('id-1');
          return jsonResponse({ accepted: true, executionId: 'ex-1' });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const result = await client.intent('s', 'e', 'T', {}, 'id-1');
    expect(result.accepted).toBe(true);
  });
});

describe('CausetClient select', () => {
  it('fires handler on state change', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1, y: 10 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            statePatch: [{ op: 'replace', path: '/x', value: 2 }],
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const values: unknown[] = [];
    await client.subscribe('s', 'e');
    const unsub = client.select('s', 'e', (s) => s.x, (v) => values.push(v));
    expect(values).toEqual([1]);
    await client.intent('s', 'e', 'INC', {});
    expect(values).toEqual([1, 2]);
    unsub();
  });

  it('select without existing state still registers', () => {
    const client = makeClient();
    const unsub = client.select('s', 'e', (s) => s.x, () => undefined);
    unsub();
  });
});

describe('CausetClient runQuery and list helpers', () => {
  it('runQuery proxies to http', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/q1/run')) {
          return jsonResponse({ items: [{ id: 1 }] });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const result = await client.runQuery('q1', { k: 'v' }, { limit: 10 });
    expect(result.items).toEqual([{ id: 1 }]);
  });

  it('listQueries proxies to http', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/queries') && !url.includes('/run')) {
          return jsonResponse([{ slug: 'q1' }]);
        }
        return null!;
      },
    ]);
    expect(await makeClient({ fetchImpl }).listQueries()).toEqual([{ slug: 'q1' }]);
  });

  it('getQueryDefinition proxies to http', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/queries/q1')) return jsonResponse({ slug: 'q1' });
        return null!;
      },
    ]);
    expect(await makeClient({ fetchImpl }).getQueryDefinition('q1')).toEqual({ slug: 'q1' });
  });

  it('listProjections proxies to http', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/projections')) return jsonResponse([{ name: 'p1' }]);
        return null!;
      },
    ]);
    expect(await makeClient({ fetchImpl }).listProjections()).toEqual([{ name: 'p1' }]);
  });

  it('listEntities proxies to http', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/entities') && !url.includes('/state')) {
          return jsonResponse({ entities: [], total: 0 });
        }
        return null!;
      },
    ]);
    const result = await makeClient({ fetchImpl }).listEntities({ streamName: 'orders' });
    expect(result.entities).toEqual([]);
  });

  it('fetchState one-shot does not subscribe', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { a: 1 }, snapshotVersion: 3 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const result = await client.fetchState('s', 'e');
    expect(result.state).toEqual({ a: 1 });
    expect(result.cursor).toBe(3);
    expect(client.getState('s', 'e')).toBeNull();
  });
});

describe('CausetClient intentStream', () => {
  it('intentStream with intentId includes it in body', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.startsWith(STREAM_URL)) {
          const body = JSON.parse(init.body as string);
          expect(body.intentId).toBe('intent-99');
          const stream = new ReadableStream({ start(c) { c.close(); } });
          return new Response(stream, { status: 200 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.intentStream('s', 'e', 'T', {}, () => undefined, 'intent-99');
  });

  it('intentStream generates intentId when omitted', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.startsWith(STREAM_URL)) {
          const body = JSON.parse(init.body as string);
          expect(typeof body.intentId).toBe('string');
          expect(body.intentId.length).toBeGreaterThan(0);
          const stream = new ReadableStream({ start(c) { c.close(); } });
          return new Response(stream, { status: 200 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.intentStream('s', 'e', 'T', {}, () => undefined);
  });

  it('uses bound default fetchImpl in constructor', () => {
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      bearerToken: 'jwt',
    });
    const impl = (client as unknown as { fetchImpl: typeof fetch }).fetchImpl;
    expect(impl).toBeTypeOf('function');
    expect(impl).not.toBe(fetch); // must be wrapped — detached fetch throws Illegal invocation in browsers
  });

  it('submits intent stream with bearer token', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.startsWith(STREAM_URL)) {
          const stream = new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
              c.close();
            },
          });
          return new Response(stream, { status: 200 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const events: unknown[] = [];
    await client.intentStream('s', 'e', 'T', {}, (ev) => events.push(ev.data), 'intent-1');
    expect(events).toEqual([{ ok: true }]);
  });
});

describe('CausetClient apiKey auth and retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries on 401 with forceRefresh', async () => {
    let stateCalls = 0;
    let tokenCalls = 0;
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (url.endsWith('/v1/token')) {
          tokenCalls += 1;
          return jsonResponse({ token: tokenCalls === 1 ? 'jwt-old' : 'jwt-new', expiresIn: 300 });
        }
        if (init?.method === 'GET' && url.includes('/state')) {
          stateCalls += 1;
          const auth = (init.headers as Record<string, string>).Authorization;
          if (auth === 'Bearer jwt-old' && stateCalls === 1) {
            return jsonResponse({ error: 'expired' }, 401);
          }
          return jsonResponse({ snapshotJson: { ok: true }, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      apiKey: 'ck_test',
      fetchImpl,
    });
    await client.init();
    await client.subscribe('s', 'e');
    expect(client.getState('s', 'e')).toEqual({ ok: true });
    expect(tokenCalls).toBe(2);
    client.destroy();
  });

  it('init and destroy with apiKey token manager', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.endsWith('/v1/token')) return jsonResponse({ token: 'jwt', expiresIn: 300 });
        return null!;
      },
    ]);
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      apiKey: 'ck_test',
      fetchImpl,
    });
    await client.init();
    client.destroy();
  });
});

describe('CausetClient stream transport', () => {
  type WsInst = {
    onopen: (() => void) | null;
    onmessage: ((msg: { data: string }) => void) | null;
    onclose: (() => void) | null;
    sent: string[];
    send: (d: string) => void;
    close: () => void;
  };

  function mockWs() {
    const instances: WsInst[] = [];
    class MockWS {
      onopen: (() => void) | null = null;
      onmessage: ((msg: { data: string }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      sent: string[] = [];
      constructor(_url: string) {
        const inst: WsInst = {
          onopen: null,
          onmessage: null,
          onclose: null,
          sent: this.sent,
          send: (d: string) => {
            this.sent.push(d);
          },
          close: () => this.onclose?.(),
        };
        Object.assign(this, inst);
        instances.push(this as unknown as WsInst);
        queueMicrotask(() => this.onopen?.());
      }
    }
    return { MockWS, instances };
  }

  it('connectStream sends JWT-authenticated hello without tenant fields', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const token = jwtWithOrgId('org-from-jwt');
    const fetchImpl = createMockFetch([]);
    const client = makeClient({ bearerToken: token, fetchImpl });
    const connected: unknown[] = [];
    client.on('stream_connected', (d) => connected.push(d));
    const connPromise = client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    expect(await connPromise).toBe('c1');
    const hello = JSON.parse(instances[0].sent[0]);
    expect(hello.project_id).toBeUndefined();
    expect(hello.stream_id).toBe('orders');
    expect(connected).toHaveLength(1);
    client.disconnectStream();
    vi.unstubAllGlobals();
  });

  it('connectStream sends stream-only hello', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const client = makeClient();
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    const hello = JSON.parse(instances[0].sent[0]);
    expect(hello.project_id).toBeUndefined();
    expect(hello.fork_id).toBe('main');
    expect(hello.env).toBeUndefined();
    expect(hello.stream_id).toBe('orders');
    client.disconnectStream();
    vi.unstubAllGlobals();
  });

  it('handleStreamEvent applies patch to subscription', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('orders', 'e1');
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });

    const patches: unknown[] = [];
    client.on('patch_op', (d) => patches.push(d));
    instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'event',
        entity_id: 'e1',
        patch: [{ op: 'replace', path: '/x', value: 5 }],
      }),
    });
    expect(client.getState('orders', 'e1')).toEqual({ x: 5 });
    expect(patches).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('handleStreamEvent emits emitted events', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: {}, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('orders', 'e1');
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });

    const emitted: unknown[] = [];
    client.on('emitted', (d) => emitted.push(d));
    instances[0].onmessage?.({
      data: JSON.stringify({ type: 'event', entity_id: 'e1', emits: [{ name: 'OrderCreated' }] }),
    });
    expect(emitted).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('handleStreamEvent ignores patch without subscription', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const client = makeClient();
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'event',
        entity_id: 'missing',
        patch: [{ op: 'add', path: '/a', value: 1 }],
      }),
    });
    vi.unstubAllGlobals();
  });

  it('emits client error on websocket transport error', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const client = makeClient();
    const errors: unknown[] = [];
    client.on('error', (e) => errors.push(e));
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    (instances[0] as unknown as { onerror: ((e: unknown) => void) | null }).onerror?.(
      new Event('ws-error'),
    );
    expect(errors).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('emits stream_disconnected on close', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const client = makeClient();
    const disconnected: unknown[] = [];
    client.on('stream_disconnected', (d) => disconnected.push(d));
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    instances[0].close();
    expect(disconnected).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('handleStreamEvent ignores patch without entity_id', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const client = makeClient();
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    instances[0].onmessage?.({
      data: JSON.stringify({ type: 'event', patch: [{ op: 'add', path: '/a', value: 1 }] }),
    });
    vi.unstubAllGlobals();
  });

  it('handleStreamEvent ignores non-array patch', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('orders', 'e1');
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    instances[0].onmessage?.({
      data: JSON.stringify({ type: 'event', entity_id: 'e1', patch: 'not-array' }),
    });
    expect(client.getState('orders', 'e1')).toEqual({ x: 1 });
    vi.unstubAllGlobals();
  });

  it('connectStream passes apiKey and fromCursor', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.endsWith('/v1/token')) return jsonResponse({ token: 'jwt', expiresIn: 300 });
        return null!;
      },
    ]);
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      apiKey: 'ck_test',
      fetchImpl,
    });
    await client.init();
    void client.connectStream('orders', { fromCursor: 5, channels: [{ channel: 'ledger' }] });
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    expect(instances[0].sent[0]).toContain('"from_cursor":5');
    expect(instances[0].sent[0]).toContain('"channel":"ledger"');
    client.disconnectStream();
    vi.unstubAllGlobals();
  });

  it('destroy disconnects stream and token manager', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.endsWith('/v1/token')) return jsonResponse({ token: 'jwt', expiresIn: 300 });
        return null!;
      },
    ]);
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      apiKey: 'ck_test',
      fetchImpl,
    });
    await client.init();
    void client.connectStream('orders');
    await vi.waitFor(() => expect(instances[0]?.sent.length).toBe(1));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    client.destroy();
    vi.unstubAllGlobals();
  });

  it('connectStreams keeps multiple websocket transports', async () => {
    const { MockWS, instances } = mockWs();
    vi.stubGlobal('WebSocket', MockWS);
    const client = makeClient();
    const p = client.connectStreams(['wallet_stream', 'transfer_stream']);
    await vi.waitFor(() => expect(instances.length).toBe(2));
    instances[0].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c1' }) });
    instances[1].onmessage?.({ data: JSON.stringify({ type: 'welcome', conn_id: 'c2' }) });
    await p;
    expect(client.isStreamConnected('wallet_stream')).toBe(true);
    expect(client.isStreamConnected('transfer_stream')).toBe(true);
    client.disconnectStream('wallet_stream');
    expect(client.isStreamConnected('wallet_stream')).toBe(false);
    expect(client.isStreamConnected('transfer_stream')).toBe(true);
    client.disconnectStream();
    expect(client.isStreamConnected()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('connectStream sse uses resolved ids and live-only cursor', async () => {
    const urls: string[] = [];
    const fetchImpl = createMockFetch([
      (url) => {
        urls.push(url);
        if (url.includes('/events')) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: WALLET_FUNDED\ndata: {"entity_id":"w1","amount":1}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({
      fetchImpl,
      streamTransport: 'sse',
      realtimeUrl: 'http://localhost:8081',
      platformId: 'plat-uuid',
      applicationId: 'app-uuid',
    });
    const domain: unknown[] = [];
    client.on('domain_event', (d) => domain.push(d));
    await client.connectStream('wallet_stream', { transport: 'sse', fromCursor: -1 });
    expect(urls[0]).toContain('/platforms/plat-uuid/applications/app-uuid/streams/wallet_stream/events');
    expect(urls[0]).toContain('from_cursor=-1');
    await vi.waitFor(() => expect(domain.length).toBeGreaterThan(0));
    client.disconnectStream();
  });

  it('connectStream sse emits client error on transport failure', async () => {
    const fetchImpl = createMockFetch([
      () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.error(new Error('sse-boom'));
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    ]);
    const client = makeClient({
      fetchImpl,
      streamTransport: 'sse',
      realtimeUrl: 'http://localhost:8081',
      platformId: 'p',
      applicationId: 'a',
    });
    const errors: unknown[] = [];
    client.on('error', (e) => errors.push(e));
    await client.connectStream('wallet_stream', { transport: 'sse' });
    await vi.waitFor(() => expect(errors.length).toBe(1));
    client.disconnectStream();
  });

  it('resolveIds maps slugs to UUIDs', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/v1/cli/platforms')) {
          return jsonResponse([{ id: 'plat-1', slug: 'org1' }]);
        }
        if (url.includes('/v1/cli/apps')) {
          return jsonResponse([{ id: 'app-1', slug: 'app1', platform_id: 'plat-1' }]);
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl, bearerToken: '' });
    const ids = await client.resolveIds();
    expect(ids).toEqual({ platformId: 'plat-1', applicationId: 'app-1' });
    expect(client.platformId).toBe('plat-1');
    // Cached path
    expect(await client.resolveIds()).toEqual(ids);
  });

  it('resolveIds falls back when platform_id does not match', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/v1/cli/platforms')) {
          return jsonResponse({ platforms: [{ id: 'plat-1', slug: 'org1' }] });
        }
        if (url.includes('/v1/cli/apps')) {
          return jsonResponse({ apps: [{ id: 'app-9', slug: 'app1', platform_id: 'other' }] });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const ids = await client.resolveIds();
    expect(ids.applicationId).toBe('app-9');
  });

  it('resolveIds accepts data[] catalog shape', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/v1/cli/platforms')) {
          return jsonResponse({ data: [{ id: 'plat-d', slug: 'org1' }] });
        }
        if (url.includes('/v1/cli/apps')) {
          return jsonResponse({ data: [{ id: 'app-d', slug: 'app1', platform_id: 'plat-d' }] });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    expect(await client.resolveIds()).toEqual({ platformId: 'plat-d', applicationId: 'app-d' });
  });

  it('resolveIds treats unknown catalog shapes as empty', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/v1/cli/platforms')) return jsonResponse({ unexpected: true });
        if (url.includes('/v1/cli/apps')) return jsonResponse(null);
        return null!;
      },
    ]);
    await expect(makeClient({ fetchImpl }).resolveIds()).rejects.toThrow(/Platform not found/);
  });

  it('resolveIds throws when platform or app missing', async () => {
    const missingPlat = createMockFetch([
      (url) => {
        if (url.includes('/v1/cli/platforms')) return jsonResponse([]);
        if (url.includes('/v1/cli/apps')) return jsonResponse([{ id: 'a', slug: 'app1' }]);
        return null!;
      },
    ]);
    await expect(makeClient({ fetchImpl: missingPlat }).resolveIds()).rejects.toThrow(/Platform not found/);

    const missingApp = createMockFetch([
      (url) => {
        if (url.includes('/v1/cli/platforms')) return jsonResponse([{ id: 'p', slug: 'org1' }]);
        if (url.includes('/v1/cli/apps')) return jsonResponse([]);
        return null!;
      },
    ]);
    await expect(makeClient({ fetchImpl: missingApp }).resolveIds()).rejects.toThrow(/Application not found/);
  });

  it('websocket connectStream requires credentials', async () => {
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      fetchImpl: createMockFetch([]),
    });
    await expect(client.connectStream('orders')).rejects.toThrow(/requires apiKey or bearerToken/);
  });
});

describe('CausetClient edge cases', () => {
  it('uses empty bearer token when no auth configured', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (url.includes('/state')) {
          expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
          return jsonResponse({ snapshotJson: { a: 1 }, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      fetchImpl,
    });
    await client.fetchState('s', 'e');
  });

  it('applies default option fallbacks in constructor', () => {
    const client = new CausetClient({
      apiUrl: BASE,
      platformSlug: 'org1',
      appSlug: 'app1',
      forkId: 'dev',
      wsUrl: 'wss://custom/ws',
      apiKey: 'ck',
    });
    expect(client.forkId).toBe('dev');
    expect(client.wsUrl).toBe('wss://custom/ws');
    expect(client.apiKey).toBe('ck');
    expect(client.bearerToken).toBe('');
  });

  it('accepted intent without patch refetches null state as empty object', async () => {
    let stateCalls = 0;
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          stateCalls += 1;
          if (stateCalls === 1) {
            return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
          }
          return new Response(null, { status: 404 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    await client.intent('s', 'e', 'UPDATE', {});
    expect(client.getState('s', 'e')).toEqual({});
  });

  it('deepClone handles selector changing to null', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            statePatch: [{ op: 'replace', path: '/x', value: null }],
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const values: unknown[] = [];
    await client.subscribe('s', 'e');
    client.select('s', 'e', (st) => st.x, (v) => values.push(v));
    expect(values).toEqual([1]);
    await client.intent('s', 'e', 'T', {});
    expect(values).toEqual([1, null]);
  });

  it('init without token manager is no-op', async () => {
    await makeClient().init();
  });

  it('destroy without stream or token manager', () => {
    makeClient().destroy();
  });

  it('accepted intent without subscription is safe', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: true, statePatch: [{ op: 'add', path: '/a', value: 1 }] });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.intent('s', 'e', 'T', {});
    expect(client.getState('s', 'e')).toBeNull();
  });

  it('accepted intent with non-array statePatch skips apply', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: true, statePatch: { bad: true } });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    await client.intent('s', 'e', 'T', {});
    expect(client.getState('s', 'e')).toEqual({ x: 1 });
  });

  it('notifySelectors skips non-matching entries', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            statePatch: [{ op: 'replace', path: '/x', value: 2 }],
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const otherValues: unknown[] = [];
    await client.subscribe('s', 'e');
    client.select('other', 'entity', (st) => st.x, (v) => otherValues.push(v));
    await client.intent('s', 'e', 'T', {});
    expect(otherValues).toEqual([]);
  });

  it('notifySelectors skips when selector value unchanged', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: 1 }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            statePatch: [{ op: 'replace', path: '/y', value: 9 }],
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const values: unknown[] = [];
    await client.subscribe('s', 'e');
    client.select('s', 'e', (st) => st.x, (v) => values.push(v));
    expect(values).toEqual([1]);
    await client.intent('s', 'e', 'T', {});
    expect(values).toEqual([1]);
  });

  it('deepClone preserves null selector values', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/state')) {
          return jsonResponse({ snapshotJson: { x: null }, snapshotVersion: 1 });
        }
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            statePatch: [{ op: 'replace', path: '/x', value: 1 }],
          });
        }
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    const values: unknown[] = [];
    await client.subscribe('s', 'e');
    client.select('s', 'e', (st) => st.x, (v) => values.push(v));
    expect(values).toEqual([null]);
    await client.intent('s', 'e', 'T', {});
    expect(values).toEqual([null, 1]);
  });
});

describe('CausetClient on/off emitter', () => {
  it('on registers client-level events', () => {
    const client = makeClient();
    const received: unknown[] = [];
    const unsub = client.on('custom', (d) => received.push(d));
    client.on('custom', () => undefined);
    unsub();
  });
});

describe('CausetClient runWithRetry non-401 errors', () => {
  it('rethrows non-auth errors', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return jsonResponse({ error: 'bad' }, 500);
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await expect(client.fetchState('s', 'e')).rejects.toThrow(CausetApiError);
  });
});

describe('CausetClient deepClone null', () => {
  it('subscribe handles null state from fetch', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return new Response(null, { status: 404 });
        return null!;
      },
    ]);
    const client = makeClient({ fetchImpl });
    await client.subscribe('s', 'e');
    expect(client.getState('s', 'e')).toEqual({});
  });
});
