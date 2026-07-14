import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as server from '../server.js';

const originalEnv = { ...process.env };

describe('createServerCausetClient', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves config from CAUSET_* env vars', () => {
    process.env.CAUSET_API_URL = 'https://api.test';
    process.env.CAUSET_PLATFORM = 'plat';
    process.env.CAUSET_APPLICATION = 'app';
    process.env.CAUSET_FORK = 'dev';
    process.env.CAUSET_API_KEY = 'ck_test';

    const client = server.createServerCausetClient();
    expect(client.apiUrl).toBe('https://api.test');
    expect(client.platformSlug).toBe('plat');
    expect(client.appSlug).toBe('app');
    expect(client.forkId).toBe('dev');
    expect(client.apiKey).toBe('ck_test');
  });

  it('falls back to NEXT_PUBLIC_* env vars', () => {
    delete process.env.CAUSET_API_URL;
    delete process.env.CAUSET_PLATFORM;
    delete process.env.CAUSET_APPLICATION;
    process.env.NEXT_PUBLIC_CAUSET_API_URL = 'https://public.api';
    process.env.NEXT_PUBLIC_CAUSET_PLATFORM = 'pub-plat';
    process.env.NEXT_PUBLIC_CAUSET_APPLICATION = 'pub-app';

    const client = server.createServerCausetClient();
    expect(client.apiUrl).toBe('https://public.api');
    expect(client.platformSlug).toBe('pub-plat');
    expect(client.appSlug).toBe('pub-app');
  });

  it('uses default apiUrl when env unset', () => {
    delete process.env.CAUSET_API_URL;
    delete process.env.NEXT_PUBLIC_CAUSET_API_URL;
    const client = server.createServerCausetClient({
      platformSlug: 'p',
      appSlug: 'a',
    });
    expect(client.apiUrl).toBe('http://localhost:8085');
  });

  it('prefers bearerToken when apiKey absent', () => {
    process.env.CAUSET_BEARER_TOKEN = 'jwt-server';
    const client = server.createServerCausetClient({
      platformSlug: 'p',
      appSlug: 'a',
    });
    expect((client as unknown as { bearerToken: string }).bearerToken).toBe('jwt-server');
  });

  it('overrides env with explicit config', () => {
    process.env.CAUSET_PLATFORM = 'env-plat';
    const client = server.createServerCausetClient({
      platformSlug: 'override-plat',
      appSlug: 'override-app',
      apiUrl: 'https://override',
      forkId: 'fork-x',
      apiKey: 'ck_override',
    });
    expect(client.platformSlug).toBe('override-plat');
    expect(client.appSlug).toBe('override-app');
    expect(client.apiUrl).toBe('https://override');
    expect(client.forkId).toBe('fork-x');
    expect(client.apiKey).toBe('ck_override');
  });

  it('throws when platform or application missing', () => {
    delete process.env.CAUSET_PLATFORM;
    delete process.env.NEXT_PUBLIC_CAUSET_PLATFORM;
    expect(() => server.createServerCausetClient({ appSlug: 'a' })).toThrow(
      'CAUSET_PLATFORM and CAUSET_APPLICATION (or overrides) are required',
    );
    expect(() => server.createServerCausetClient({ platformSlug: 'p' })).toThrow(
      'CAUSET_PLATFORM and CAUSET_APPLICATION (or overrides) are required',
    );
  });
});

describe('serverEmitIntent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates client, emits, and destroys', async () => {
    const emitResult = { accepted: true };
    const mockClient = {
      init: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn().mockResolvedValue(emitResult),
      destroy: vi.fn(),
    };
    const core = await import('@causet/sdk-core');
    vi.spyOn(core, 'CausetClient').mockImplementation(
      () => mockClient as unknown as InstanceType<typeof core.CausetClient>,
    );

    const result = await server.serverEmitIntent('s', 'e', 'INTENT', { x: 1 }, {
      platformSlug: 'p',
      appSlug: 'a',
      bearerToken: 'jwt',
    });
    expect(mockClient.init).toHaveBeenCalled();
    expect(mockClient.emit).toHaveBeenCalledWith('s', 'e', 'INTENT', { x: 1 });
    expect(mockClient.destroy).toHaveBeenCalled();
    expect(result).toEqual(emitResult);
  });
});

describe('serverRunQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates client, runs query, and destroys', async () => {
    const queryResult = { items: [{ id: 1 }] };
    const mockClient = {
      init: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue(queryResult),
      destroy: vi.fn(),
    };
    const core = await import('@causet/sdk-core');
    vi.spyOn(core, 'CausetClient').mockImplementation(
      () => mockClient as unknown as InstanceType<typeof core.CausetClient>,
    );

    const result = await server.serverRunQuery('q1', { k: 'v' }, {
      platformSlug: 'p',
      appSlug: 'a',
      bearerToken: 'jwt',
      limit: 10,
      includeTotal: true,
    });
    expect(mockClient.runQuery).toHaveBeenCalledWith('q1', { k: 'v' }, {
      limit: 10,
      cursor: undefined,
      includeTotal: true,
    });
    expect(mockClient.destroy).toHaveBeenCalled();
    expect(result).toEqual(queryResult);
  });
});
