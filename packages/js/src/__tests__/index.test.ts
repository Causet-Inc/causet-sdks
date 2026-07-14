import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';
import {
  CausetClient,
  CausetError,
  CausetAuthError,
  CausetApiError,
  flattenProjectionItems,
  flattenProjectionRow,
  stringifyQueryInput,
  submitIntentStream,
  parseSseChunk,
  openEventSource,
  CausetTransportWebSocket,
  ApiKeyTokenManager,
  deriveWsUrl,
  orgIdFromToken,
} from '../index.js';

describe('@causet/sdk re-exports', () => {
  it('exports CausetClient', () => {
    expect(sdk.CausetClient).toBe(CausetClient);
  });

  it('exports error classes', () => {
    expect(sdk.CausetError).toBe(CausetError);
    expect(sdk.CausetAuthError).toBe(CausetAuthError);
    expect(sdk.CausetApiError).toBe(CausetApiError);
  });

  it('exports query projection helpers', () => {
    expect(sdk.flattenProjectionRow).toBe(flattenProjectionRow);
    expect(sdk.flattenProjectionItems).toBe(flattenProjectionItems);
    expect(sdk.stringifyQueryInput).toBe(stringifyQueryInput);
  });

  it('exports transport helpers', () => {
    expect(sdk.submitIntentStream).toBe(submitIntentStream);
    expect(sdk.parseSseChunk).toBe(parseSseChunk);
    expect(sdk.openEventSource).toBe(openEventSource);
    expect(sdk.CausetTransportWebSocket).toBe(CausetTransportWebSocket);
    expect(sdk.CausetTransportStreamSse).toBeTypeOf('function');
    expect(sdk.extractDomainEvents).toBeTypeOf('function');
  });

  it('exports token manager helpers', () => {
    expect(sdk.ApiKeyTokenManager).toBe(ApiKeyTokenManager);
    expect(sdk.deriveWsUrl).toBe(deriveWsUrl);
    expect(sdk.orgIdFromToken).toBe(orgIdFromToken);
  });
});
