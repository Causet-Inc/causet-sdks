import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CausetAuthError } from '../errors.js';
import { ApiKeyTokenManager, deriveWsUrl, orgIdFromToken } from '../token-manager.js';

const API_URL = 'https://api.causet.cloud';
const API_KEY = 'ck_live_test.secret123';

function tokenResponse(token: string, expiresIn = 300): Response {
  return new Response(JSON.stringify({ token, expiresIn }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiKeyTokenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exchanges api key for token', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-abc'));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const token = await mgr.getToken();
      expect(token).toBe('jwt-abc');
    } finally {
      mgr.destroy();
    }
  });

  it('uses ApiKey authorization header', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe(`ApiKey ${API_KEY}`);
      return tokenResponse('jwt-abc');
    });
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      await mgr.getToken();
    } finally {
      mgr.destroy();
    }
  });

  it('caches token without refetching', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-abc'));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const t1 = await mgr.getToken();
      const t2 = await mgr.getToken();
      expect(t1).toBe(t2);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      mgr.destroy();
    }
  });

  it('coalesces concurrent getToken calls', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-coalesced'));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const tokens = await Promise.all([mgr.getToken(), mgr.getToken(), mgr.getToken()]);
      expect(tokens).toEqual(['jwt-coalesced', 'jwt-coalesced', 'jwt-coalesced']);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      mgr.destroy();
    }
  });

  it('raises CausetAuthError on exchange failure', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 }),
    );
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      await expect(mgr.getToken()).rejects.toThrow(CausetAuthError);
      await expect(mgr.getToken()).rejects.toThrow('Invalid API key');
    } finally {
      mgr.destroy();
    }
  });

  it('raises when token missing in response', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ expiresIn: 300 }), { status: 200 }),
    );
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      await expect(mgr.getToken()).rejects.toThrow('Token exchange returned no token');
    } finally {
      mgr.destroy();
    }
  });

  it('init eagerly exchanges', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-eager'));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      await mgr.init();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      mgr.destroy();
    }
  });

  it('destroy clears refresh timer', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-abc', 600));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    await mgr.init();
    mgr.destroy();
    fetchImpl.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forceRefresh fetches new token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('jwt-first'))
      .mockResolvedValueOnce(tokenResponse('jwt-second'));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const t1 = await mgr.getToken();
      expect(t1).toBe('jwt-first');
      const t2 = await mgr.forceRefresh();
      expect(t2).toBe('jwt-second');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      mgr.destroy();
    }
  });

  it('retries on network errors then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(tokenResponse('jwt-retry'));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const promise = mgr.getToken();
      await vi.advanceTimersByTimeAsync(350);
      const token = await promise;
      expect(token).toBe('jwt-retry');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      mgr.destroy();
    }
  });

  it('throws after max retry attempts on network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const promise = mgr.getToken();
      const assertion = expect(promise).rejects.toThrow('Causet auth unreachable');
      await vi.advanceTimersByTimeAsync(350 + 700 + 1400);
      await assertion;
    } finally {
      mgr.destroy();
    }
  });

  it('handles non-JSON error body on failed exchange', async () => {
    const fetchImpl = vi.fn(async () => new Response('plain', { status: 401 }));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      await expect(mgr.getToken()).rejects.toThrow('Token exchange failed: 401');
    } finally {
      mgr.destroy();
    }
  });

  it('schedules background refresh', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-abc', 600));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    await mgr.getToken();
    fetchImpl.mockClear();
    await vi.advanceTimersByTimeAsync(570_000);
    expect(fetchImpl).toHaveBeenCalled();
    mgr.destroy();
  });

  it('skips schedule when delay is non-positive', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse('jwt-short', 10));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    await mgr.getToken();
    fetchImpl.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it('strips trailing slash from apiUrl', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe(`${API_URL}/v1/token`);
      return tokenResponse('jwt-abc');
    });
    const mgr = new ApiKeyTokenManager(`${API_URL}/`, API_KEY, fetchImpl);
    try {
      await mgr.getToken();
    } finally {
      mgr.destroy();
    }
  });

  it('throws after max retry attempts on non-Error failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw 'plain string failure';
    });
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      const promise = mgr.getToken();
      const assertion = expect(promise).rejects.toThrow('unknown error');
      await vi.advanceTimersByTimeAsync(350 + 700 + 1400);
      await assertion;
    } finally {
      mgr.destroy();
    }
  });

  it('uses default expiresIn when omitted', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: 'jwt-x' }), { status: 200 }));
    const mgr = new ApiKeyTokenManager(API_URL, API_KEY, fetchImpl);
    try {
      await mgr.getToken();
      await mgr.forceRefresh();
    } finally {
      mgr.destroy();
    }
  });
});

describe('orgIdFromToken', () => {
  it('extracts org_id from JWT payload', () => {
    const payload = btoa(JSON.stringify({ org_id: 'org-123' }));
    const token = `header.${payload}.sig`;
    expect(orgIdFromToken(token)).toBe('org-123');
  });

  it('returns null when org_id missing', () => {
    const payload = btoa(JSON.stringify({ sub: 'user' }));
    const token = `header.${payload}.sig`;
    expect(orgIdFromToken(token)).toBeNull();
  });

  it('returns null for malformed token', () => {
    expect(orgIdFromToken('not-a-jwt')).toBeNull();
    expect(orgIdFromToken('a.b')).toBeNull();
  });

  it('handles base64url padding', () => {
    const payload = btoa(JSON.stringify({ org_id: 'org-pad' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `h.${payload}.s`;
    expect(orgIdFromToken(token)).toBe('org-pad');
  });

  it('returns null for invalid base64 payload', () => {
    expect(orgIdFromToken('a.!!!invalid!!!.c')).toBeNull();
  });
});

describe('deriveWsUrl', () => {
  it('converts https to wss', () => {
    expect(deriveWsUrl('https://api.example.com')).toBe('wss://api.example.com/ws');
  });

  it('converts http to ws (local runtime → realtime port)', () => {
    expect(deriveWsUrl('http://localhost:8085')).toBe('ws://localhost:8081/ws');
  });

  it('maps sandbox API to sandbox.realtime.causet.cloud', () => {
    expect(deriveWsUrl('https://sandbox.api.causet.cloud')).toBe(
      'wss://sandbox.realtime.causet.cloud/ws',
    );
  });

  it('appends /ws for other schemes', () => {
    expect(deriveWsUrl('custom://host')).toBe('custom://host/ws');
  });

  it('strips trailing slashes', () => {
    expect(deriveWsUrl('https://api.example.com/')).toBe('wss://api.example.com/ws');
  });
});
