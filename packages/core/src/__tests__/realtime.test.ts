import { describe, expect, it } from 'vitest';
import {
  buildStreamEventsUrl,
  deriveRealtimeUrl,
  deriveWsUrl,
  deriveWsUrlFromRealtime,
} from '../realtime.js';

describe('realtime URL helpers', () => {
  it('maps sandbox API to sandbox.realtime.causet.cloud', () => {
    expect(deriveRealtimeUrl('https://sandbox.api.causet.cloud')).toBe(
      'https://sandbox.realtime.causet.cloud',
    );
    expect(deriveWsUrl('https://sandbox.api.causet.cloud')).toBe(
      'wss://sandbox.realtime.causet.cloud/ws',
    );
  });

  it('maps prod API to realtime.causet.cloud', () => {
    expect(deriveRealtimeUrl('https://api.causet.cloud')).toBe('https://realtime.causet.cloud');
    expect(deriveWsUrl('https://api.causet.cloud')).toBe('wss://realtime.causet.cloud/ws');
  });

  it('maps local API port 8085 to realtime 8081', () => {
    expect(deriveRealtimeUrl('http://localhost:8085')).toBe('http://localhost:8081');
    expect(deriveWsUrl('http://localhost:8085')).toBe('ws://localhost:8081/ws');
  });

  it('maps generic .api. hostnames to .realtime.', () => {
    expect(deriveRealtimeUrl('https://eu.api.example.cloud')).toBe('https://eu.realtime.example.cloud');
  });

  it('returns trimmed input for invalid URLs', () => {
    expect(deriveRealtimeUrl('not a url')).toBe('not a url');
  });

  it('deriveWsUrlFromRealtime converts https to wss', () => {
    expect(deriveWsUrlFromRealtime('https://sandbox.realtime.causet.cloud')).toBe(
      'wss://sandbox.realtime.causet.cloud/ws',
    );
  });

  it('buildStreamEventsUrl uses realtime host and fork', () => {
    const url = buildStreamEventsUrl(
      'https://sandbox.realtime.causet.cloud',
      { apiUrl: 'https://sandbox.api.causet.cloud', platformSlug: 'plat', appSlug: 'app', forkId: 'sandbox' },
      { streamId: 'orders:order-1', fromCursor: 10, token: 'jwt-abc' },
    );
    expect(url).toContain('sandbox.realtime.causet.cloud');
    expect(url).toContain('fork_id=sandbox');
    expect(url).toContain('from_cursor=10');
  });

  it('buildStreamEventsUrl prefers platform/application UUIDs', () => {
    const url = buildStreamEventsUrl(
      'http://localhost:8081',
      {
        apiUrl: 'http://localhost:8085',
        platformSlug: 'test-platform',
        appSlug: 'my-wallets',
        platformId: 'plat-uuid',
        applicationId: 'app-uuid',
        forkId: 'sandbox',
      },
      { streamId: 'wallet_stream', fromCursor: -1, apiKey: 'ck_live' },
    );
    expect(url).toContain('/platforms/plat-uuid/applications/app-uuid/streams/wallet_stream/events');
    expect(url).toContain('from_cursor=-1');
    expect(url).toContain('api_key=ck_live');
  });
});
