import { describe, expect, it, vi } from 'vitest';
import { CausetApiError } from '../errors.js';
import {
  submitIntent,
  fetchState,
  getQueryDefinition,
  listEntities,
  listProjections,
  listQueries,
  runQuery,
} from '../http-client.js';
import { stringifyQueryInput } from '../query-projection.js';
import { CFG, PREFIX, RUNTIME_PREFIX, createMockFetch, emptyResponse, jsonResponse, CFG_NO_FORK } from './helpers.js';

describe('stringifyQueryInput (via runQuery)', () => {
  it('stringifies primitives and collections in query body', async () => {
    expect(
      stringifyQueryInput({ s: 'x', n: 50, f: 1.5, b: true, g: ['Pop', 'Rock'] }),
    ).toEqual({
      s: 'x',
      n: '50',
      f: '1.5',
      b: 'true',
      g: '["Pop","Rock"]',
    });
  });
});

describe('fetchState', () => {
  it('returns parsed snapshot from object snapshotJson', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/entities/orders/order-1/state')) {
          return jsonResponse({ snapshotJson: { items: [1, 2] }, snapshotVersion: 42 });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 'orders', 'order-1', fetchImpl);
    expect(result.state).toEqual({ items: [1, 2] });
    expect(result.cursor).toBe(42);
  });

  it('parses string snapshotJson', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/entities/orders/order-1/state')) {
          return jsonResponse({ snapshotJson: '{"items":[1,2]}', snapshotVersion: 10 });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 'orders', 'order-1', fetchImpl);
    expect(result.state).toEqual({ items: [1, 2] });
  });

  it('uses raw snapshotJson object', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { v: 1 }, snapshotVersion: 1 });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.state).toEqual({ v: 1 });
  });

  it('falls back to full data when snapshotJson JSON parse fails', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: 'not-json', snapshotVersion: 3 });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.state).toEqual({ snapshotJson: 'not-json', snapshotVersion: 3 });
  });

  it('uses watermark when snapshotVersion missing', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: { a: 1 }, watermark: 7 });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.cursor).toBe(7);
  });

  it('returns null state on 404', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return new Response(null, { status: 404 });
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 'orders', 'order-1', fetchImpl);
    expect(result.state).toBeNull();
    expect(result.cursor).toBe(0);
  });

  it('throws CausetApiError on 500 with error body', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return jsonResponse({ error: 'internal' }, 500);
        return null!;
      },
    ]);
    await expect(fetchState(CFG, 'orders', 'order-1', fetchImpl)).rejects.toThrow(CausetApiError);
  });

  it('throws with statusText when error body is not JSON', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return new Response('plain text', { status: 500, statusText: 'Server Error' });
        }
        return null!;
      },
    ]);
    await expect(fetchState(CFG, 'orders', 'order-1', fetchImpl)).rejects.toThrow(CausetApiError);
  });

  it('uses message field from error JSON', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return jsonResponse({ message: 'bad request' }, 400);
        return null!;
      },
    ]);
    try {
      await fetchState(CFG, 'orders', 'order-1', fetchImpl);
    } catch (e) {
      expect(e).toBeInstanceOf(CausetApiError);
      expect((e as CausetApiError).statusCode).toBe(400);
    }
  });

  it('formats HTTP rejectionCode with rejectionMessage', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse(
            { rejectionCode: 'RULE_FAIL', rejectionMessage: 'Not allowed' },
            422,
          );
        }
        return null!;
      },
    ]);
    await expect(fetchState(CFG, 'orders', 'order-1', fetchImpl)).rejects.toThrow(
      /RULE_FAIL: Not allowed/,
    );
  });

  it('uses rejectionCode alone when detail is missing', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return jsonResponse({ rejection_code: 'DENIED' }, 422);
        return null!;
      },
    ]);
    await expect(fetchState(CFG, 'orders', 'order-1', fetchImpl)).rejects.toThrow(/DENIED/);
  });

  it('strips trailing slashes from apiUrl', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url.startsWith(`${PREFIX}/entities/`)).toBe(true);
        return jsonResponse({ snapshotJson: {}, snapshotVersion: 0 });
      },
    ]);
    await fetchState({ ...CFG, apiUrl: `${CFG.apiUrl}/` }, 's', 'e', fetchImpl);
  });

  it('uses data directly when snapshotJson absent', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotVersion: 2, nested: true });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.state).toEqual({ snapshotVersion: 2, nested: true });
  });

  it('defaults cursor to 0 when version is invalid', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: {}, snapshotVersion: 'bad' });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.cursor).toBe(0);
  });

  it('uses default forkId when not configured', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url).toContain('forkId=main');
        return jsonResponse({ snapshotJson: {}, snapshotVersion: 0 });
      },
    ]);
    await fetchState({ ...CFG, forkId: undefined }, 's', 'e', fetchImpl);
  });

  it('uses snapshotVersion over watermark', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return jsonResponse({ snapshotJson: {}, snapshotVersion: 9, watermark: 1 });
        }
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.cursor).toBe(9);
  });

  it('throws using message field when error absent', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return jsonResponse({ message: 'bad gateway' }, 502, '');
        return null!;
      },
    ]);
    try {
      await fetchState(CFG, 's', 'e', fetchImpl);
    } catch (e) {
      expect((e as CausetApiError).statusCode).toBe(502);
      expect(String(e)).toContain('bad gateway');
    }
  });

  it('throws default message when statusText and body empty', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) {
          return new Response('{}', { status: 500, statusText: '' });
        }
        return null!;
      },
    ]);
    try {
      await fetchState(CFG, 's', 'e', fetchImpl);
    } catch (e) {
      expect(String(e)).toContain('Request failed');
    }
  });

  it('returns empty object cursor 0 when response body is empty', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/state')) return emptyResponse();
        return null!;
      },
    ]);
    const result = await fetchState(CFG, 's', 'e', fetchImpl);
    expect(result.cursor).toBe(0);
  });
});

describe('submitIntent', () => {
  it('returns accepted result', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: true,
            executionId: 'exec-1',
            statePatch: [{ op: 'replace', path: '/x', value: 1 }],
          });
        }
        return null!;
      },
    ]);
    const result = await submitIntent(CFG, 'orders', 'order-1', 'PLACE_ORDER', { foo: 'bar' }, undefined, fetchImpl);
    expect(result.accepted).toBe(true);
    expect(result.executionId).toBe('exec-1');
    expect(result.statePatch).toEqual([{ op: 'replace', path: '/x', value: 1 }]);
  });

  it('sends Authorization header', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-test');
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    await submitIntent(CFG, 's', 'e', 'T', {}, undefined, fetchImpl);
  });

  it('generates intentId when omitted', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          const body = JSON.parse(init.body as string);
          expect(typeof body.intentId).toBe('string');
          expect(body.intentId.length).toBeGreaterThan(0);
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    await submitIntent(CFG, 's', 'e', 'T', {}, undefined, fetchImpl);
  });

  it('includes intentId when provided', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          const body = JSON.parse(init.body as string);
          expect(body.intentId).toBe('intent-123');
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    await submitIntent(CFG, 's', 'e', 'T', {}, 'intent-123', fetchImpl);
  });

  it('uses explicit forkId in runtime submit body', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          const body = JSON.parse(init.body as string);
          expect(body.forkId).toBe('dev');
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    await submitIntent({ ...CFG, forkId: 'dev' }, 's', 'e', 'T', {}, undefined, fetchImpl);
  });

  it('defaults forkId to main in submit body', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          const body = JSON.parse(init.body as string);
          expect(body.forkId).toBe('main');
          return jsonResponse({ accepted: true });
        }
        return null!;
      },
    ]);
    await submitIntent(CFG_NO_FORK, 's', 'e', 'T', {}, undefined, fetchImpl);
  });

  it('works without bearer token', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          const headers = init.headers as Record<string, string>;
          expect(headers.Authorization).toBeUndefined();
          return jsonResponse({ accepted: false, error: 'denied' });
        }
        return null!;
      },
    ]);
    const result = await submitIntent(
      { ...CFG, bearerToken: undefined },
      's',
      'e',
      'T',
      {},
      undefined,
      fetchImpl,
    );
    expect(result.accepted).toBe(false);
    expect(result.error).toBe('denied');
  });

  it('formats rejectionCode and rejectionMessage when not accepted', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({
            accepted: false,
            rejectionCode: 'INSUFFICIENT_FUNDS',
            rejectionMessage: 'Wallet balance is too low for this transfer',
          });
        }
        return null!;
      },
    ]);
    const result = await submitIntent(CFG, 's', 'e', 'TRANSFER_START', {}, undefined, fetchImpl);
    expect(result.accepted).toBe(false);
    expect(result.rejectionCode).toBe('INSUFFICIENT_FUNDS');
    expect(result.rejectionMessage).toBe('Wallet balance is too low for this transfer');
    expect(result.error).toBe('INSUFFICIENT_FUNDS: Wallet balance is too low for this transfer');
  });

  it('uses rejectionCode alone when message is missing', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/intents/submit')) {
          return jsonResponse({ accepted: false, rejectionCode: 'SAME_WALLET' });
        }
        return null!;
      },
    ]);
    const result = await submitIntent(CFG, 's', 'e', 'TRANSFER_START', {}, undefined, fetchImpl);
    expect(result.error).toBe('SAME_WALLET');
  });
});

describe('runQuery', () => {
  it('returns flattened items', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/order_history/run')) {
          return jsonResponse({ items: [{ id: 1 }], next_cursor: 'abc' });
        }
        return null!;
      },
    ]);
    const result = await runQuery(CFG, 'order_history', { user_id: 'u1' }, { limit: 10, fetchImpl });
    expect(result.items).toEqual([{ id: 1 }]);
    expect(result.next_cursor).toBe('abc');
  });

  it('flattens projection table dot column keys', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/joined/run')) {
          return jsonResponse({
            items: [{ 'artist_directory.artist_id': 'bruno-mars', 'show_directory.show_id': 'z7' }],
          });
        }
        return null!;
      },
    ]);
    const result = await runQuery(CFG, 'joined', {}, { fetchImpl });
    expect(result.items).toEqual([{ artist_id: 'bruno-mars', show_id: 'z7' }]);
  });

  it('stringifies non-string input and sends pagination', async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/get_artists_by_genres/run')) {
          capturedBody = JSON.parse(init.body as string);
          return jsonResponse({ items: [] });
        }
        return null!;
      },
    ]);
    await runQuery(
      CFG,
      'get_artists_by_genres',
      { genres: ['Pop', 'Rock'], limit: 50 },
      { limit: 25, includeTotal: true, fetchImpl },
    );
    expect(capturedBody.input).toEqual({
      genres: '["Pop","Rock"]',
      limit: '50',
    });
    expect(capturedBody.limit).toBe(25);
    expect(capturedBody.include_total).toBe(true);
  });

  it('sends offset when no cursor and offset > 0', async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/search_concerts/run')) {
          capturedBody = JSON.parse(init.body as string);
          return jsonResponse({ items: [], total_count: 42 });
        }
        return null!;
      },
    ]);
    await runQuery(
      CFG,
      'search_concerts',
      { query: 'Future' },
      { limit: 30, offset: 30, includeTotal: true, fetchImpl },
    );
    expect(capturedBody.offset).toBe(30);
    expect(capturedBody.include_total).toBe(true);
    expect(capturedBody.cursor).toBeUndefined();
  });

  it('omits offset when offset is zero', async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/get_artists/run')) {
          capturedBody = JSON.parse(init.body as string);
          return jsonResponse({ items: [] });
        }
        return null!;
      },
    ]);
    await runQuery(CFG, 'get_artists', {}, { limit: 50, offset: 0, includeTotal: true, fetchImpl });
    expect(capturedBody.offset).toBeUndefined();
  });

  it('prefers cursor over offset', async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/queries/search_concerts/run')) {
          capturedBody = JSON.parse(init.body as string);
          return jsonResponse({ items: [] });
        }
        return null!;
      },
    ]);
    await runQuery(
      CFG,
      'search_concerts',
      { query: 'Future' },
      { limit: 30, offset: 999, cursor: 'opaque-next', fetchImpl },
    );
    expect(capturedBody.cursor).toBe('opaque-next');
    expect(capturedBody.offset).toBeUndefined();
  });

  it('defaults forkId to main in run URL', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/forks/main/queries/q/run')) {
          return jsonResponse({ items: [] });
        }
        return null!;
      },
    ]);
    await runQuery(CFG_NO_FORK, 'q', {}, { fetchImpl });
  });

  it('uses explicit forkId in run URL', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/forks/staging/queries/q/run')) {
          return jsonResponse({ items: [] });
        }
        return null!;
      },
    ]);
    await runQuery({ ...CFG, forkId: 'staging' }, 'q', {}, { fetchImpl });
  });

  it('returns empty object when response body is empty', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'POST' && url.includes('/run')) return emptyResponse();
        return null!;
      },
    ]);
    const result = await runQuery(CFG, 'q', {}, { fetchImpl });
    expect(result).toEqual({});
  });
});

describe('listQueries', () => {
  it('returns query list', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/forks/main/queries') && !url.includes('/run')) {
          return jsonResponse([{ slug: 'q1' }]);
        }
        return null!;
      },
    ]);
    const result = await listQueries(CFG, fetchImpl);
    expect(result).toEqual([{ slug: 'q1' }]);
  });

  it('defaults forkId to main in query list URL', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/forks/main/queries')) {
          return jsonResponse([]);
        }
        return null!;
      },
    ]);
    await listQueries(CFG_NO_FORK, fetchImpl);
  });

  it('uses explicit forkId in query list URL', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/forks/staging/queries')) {
          return jsonResponse([]);
        }
        return null!;
      },
    ]);
    await listQueries({ ...CFG, forkId: 'staging' }, fetchImpl);
  });
});

describe('runQuery fetchImpl default', () => {
  it('uses default fetchImpl when opts omit fetchImpl', async () => {
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        (url, init) => {
          if (init?.method === 'POST' && url.includes('/run')) {
            return jsonResponse({ items: [{ id: 2 }] });
          }
          return null!;
        },
      ]),
    );
    const result = await runQuery(CFG, 'q', {});
    expect(result.items).toEqual([{ id: 2 }]);
    vi.unstubAllGlobals();
  });
});

describe('getQueryDefinition', () => {
  it('returns definition', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/queries/q1')) return jsonResponse({ slug: 'q1', fields: [] });
        return null!;
      },
    ]);
    const result = await getQueryDefinition(CFG, 'q1', fetchImpl);
    expect(result.slug).toBe('q1');
  });

  it('defaults forkId to main in definition URL', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url).toContain('/forks/main/queries/q1');
        return jsonResponse({ slug: 'q1' });
      },
    ]);
    await getQueryDefinition(CFG_NO_FORK, 'q1', fetchImpl);
  });

  it('uses explicit forkId in URL', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url).toContain('/forks/staging/queries/q1');
        return jsonResponse({ slug: 'q1' });
      },
    ]);
    await getQueryDefinition({ ...CFG, forkId: 'staging' }, 'q1', fetchImpl);
  });
});

describe('listProjections', () => {
  it('returns projection list', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        if (url.includes('/projections')) return jsonResponse([{ name: 'proj1' }]);
        return null!;
      },
    ]);
    const result = await listProjections(CFG, fetchImpl);
    expect(result).toEqual([{ name: 'proj1' }]);
  });

  it('defaults forkId to main in projections URL', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url).toContain('/forks/main/projections');
        return jsonResponse([]);
      },
    ]);
    await listProjections(CFG_NO_FORK, fetchImpl);
  });

  it('uses explicit forkId in URL', async () => {
    const fetchImpl = createMockFetch([
      (url) => {
        expect(url).toContain('/forks/staging/projections');
        return jsonResponse([]);
      },
    ]);
    await listProjections({ ...CFG, forkId: 'staging' }, fetchImpl);
  });
});

describe('listEntities', () => {
  it('returns entities with query params', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/entities') && !url.includes('/state')) {
          expect(url).toContain('streamName=orders');
          expect(url).toContain('searchPrefix=pre');
          expect(url).toContain('cursor=c1');
          expect(url).toContain('limit=10');
          return jsonResponse({ entities: [{ id: 'e1' }], nextCursor: 'c2', total: 5 });
        }
        return null!;
      },
    ]);
    const result = await listEntities(
      CFG,
      {
        streamName: 'orders',
        searchPrefix: 'pre',
        cursor: 'c1',
        limit: 10,
        fetchImpl,
      },
    );
    expect(result.entities).toHaveLength(1);
  });

  it('defaults forkId to main in entities params', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/entities')) {
          expect(url).toContain('forkId=main');
          return jsonResponse({ entities: [] });
        }
        return null!;
      },
    ]);
    await listEntities(CFG_NO_FORK, { fetchImpl });
  });

  it('uses explicit forkId in entities params', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/entities')) {
          expect(url).toContain('forkId=staging');
          return jsonResponse({ entities: [] });
        }
        return null!;
      },
    ]);
    await listEntities({ ...CFG, forkId: 'staging' }, { fetchImpl });
  });

  it('returns empty object when response body is empty', async () => {
    const fetchImpl = createMockFetch([
      (url, init) => {
        if (init?.method === 'GET' && url.includes('/entities') && !url.includes('/state')) {
          return emptyResponse();
        }
        return null!;
      },
    ]);
    const result = await listEntities(CFG, { fetchImpl });
    expect(result).toEqual({});
  });

  it('uses default fetchImpl when opts omit fetchImpl', async () => {
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        (url, init) => {
          if (init?.method === 'GET' && url.includes('/entities') && !url.includes('/state')) {
            return jsonResponse({ entities: [] });
          }
          return null!;
        },
      ]),
    );
    const result = await listEntities(CFG);
    expect(result.entities).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('request timeout', () => {
  it('aborts long-running requests', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ) as typeof fetch;

    const promise = fetchState(CFG, 's', 'e', fetchImpl);
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120_001);
    await assertion;
    vi.useRealTimers();
  });
});
