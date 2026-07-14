/**
 * Browser-safe default fetch. Detached `fetch` references throw
 * "Illegal invocation" when called without the Window receiver.
 */
export const boundFetch: typeof fetch = (
  (...args: Parameters<typeof fetch>) => globalThis.fetch(...args)
) as typeof fetch;
