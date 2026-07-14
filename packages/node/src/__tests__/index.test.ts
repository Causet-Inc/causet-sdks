import { describe, expect, it, vi } from 'vitest';
import { createCausetClient, CausetClient } from '../index.js';

describe('createCausetClient', () => {
  it('returns a CausetClient instance', () => {
    const client = createCausetClient({
      apiUrl: 'https://api.example.com',
      platformSlug: 'org',
      appSlug: 'app',
      bearerToken: 'jwt',
    });
    expect(client).toBeInstanceOf(CausetClient);
  });

  it('uses provided fetchImpl when set', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createCausetClient({
      apiUrl: 'https://api.example.com',
      platformSlug: 'org',
      appSlug: 'app',
      bearerToken: 'jwt',
      fetchImpl,
    });
    expect((client as unknown as { fetchImpl: typeof fetch }).fetchImpl).toBe(fetchImpl);
  });

  it('defaults fetchImpl to globalThis.fetch.bind(globalThis)', () => {
    const boundFetch = vi.fn();
    const bindSpy = vi.spyOn(globalThis.fetch, 'bind').mockReturnValue(boundFetch as unknown as typeof fetch);
    const client = createCausetClient({
      apiUrl: 'https://api.example.com',
      platformSlug: 'org',
      appSlug: 'app',
      bearerToken: 'jwt',
    });
    expect(bindSpy).toHaveBeenCalledWith(globalThis);
    expect((client as unknown as { fetchImpl: typeof fetch }).fetchImpl).toBe(boundFetch);
    bindSpy.mockRestore();
  });

  it('re-exports core symbols', async () => {
    const core = await import('@causet/sdk-core');
    expect(CausetClient).toBe(core.CausetClient);
  });
});
