/**
 * Browser-safe default fetch. Detached `fetch` references throw
 * "Illegal invocation" when called without the Window receiver.
 */
export const boundFetch = ((...args) => globalThis.fetch(...args));
