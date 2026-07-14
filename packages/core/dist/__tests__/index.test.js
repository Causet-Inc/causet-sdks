import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';
describe('index exports', () => {
    it('re-exports all public API symbols', () => {
        expect(sdk.CausetClient).toBeTypeOf('function');
        expect(sdk.CausetError).toBeTypeOf('function');
        expect(sdk.CausetAuthError).toBeTypeOf('function');
        expect(sdk.CausetApiError).toBeTypeOf('function');
        expect(sdk.flattenProjectionRow).toBeTypeOf('function');
        expect(sdk.flattenProjectionItems).toBeTypeOf('function');
        expect(sdk.stringifyQueryInput).toBeTypeOf('function');
        expect(sdk.submitIntentStream).toBeTypeOf('function');
        expect(sdk.parseSseChunk).toBeTypeOf('function');
        expect(sdk.openEventSource).toBeTypeOf('function');
        expect(sdk.CausetTransportWebSocket).toBeTypeOf('function');
        expect(sdk.ApiKeyTokenManager).toBeTypeOf('function');
        expect(sdk.deriveWsUrl).toBeTypeOf('function');
        expect(sdk.orgIdFromToken).toBeTypeOf('function');
    });
});
