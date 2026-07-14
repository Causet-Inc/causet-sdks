import { CausetClient } from '@causet/sdk-core';
/** Node.js helper — same client, explicit Node fetch. */
export function createCausetClient(options) {
    return new CausetClient({
        ...options,
        fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    });
}
export * from '@causet/sdk-core';
