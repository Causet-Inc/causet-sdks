import { CausetClient, type CausetClientOptions } from '@causet/sdk-core';

export interface CausetEnvConfig {
  apiUrl?: string;
  platformSlug?: string;
  appSlug?: string;
  forkId?: string;
  apiKey?: string;
  bearerToken?: string;
}

/** Create a server-side client from environment variables. */
export function createServerCausetClient(overrides: CausetEnvConfig = {}): CausetClient {
  const apiUrl =
    overrides.apiUrl ??
    process.env.CAUSET_API_URL ??
    process.env.NEXT_PUBLIC_CAUSET_API_URL ??
    'http://localhost:8085';
  const platformSlug =
    overrides.platformSlug ??
    process.env.CAUSET_PLATFORM ??
    process.env.NEXT_PUBLIC_CAUSET_PLATFORM ??
    '';
  const appSlug =
    overrides.appSlug ??
    process.env.CAUSET_APPLICATION ??
    process.env.NEXT_PUBLIC_CAUSET_APPLICATION ??
    '';
  const forkId = overrides.forkId ?? process.env.CAUSET_FORK ?? 'main';
  const apiKey = overrides.apiKey ?? process.env.CAUSET_API_KEY;
  const bearerToken = overrides.bearerToken ?? process.env.CAUSET_BEARER_TOKEN;

  if (!platformSlug || !appSlug) {
    throw new Error('CAUSET_PLATFORM and CAUSET_APPLICATION (or overrides) are required');
  }

  const opts: CausetClientOptions = {
    apiUrl,
    platformSlug,
    appSlug,
    forkId,
    fetchImpl: fetch,
  };
  if (apiKey) opts.apiKey = apiKey;
  else if (bearerToken) opts.bearerToken = bearerToken;

  return new CausetClient(opts);
}

export async function serverSubmitIntent(
  streamId: string,
  entityId: string,
  intentType: string,
  payload: Record<string, unknown>,
  config?: CausetEnvConfig,
) {
  const client = createServerCausetClient(config);
  await client.init();
  try {
    return await client.submitIntent(streamId, entityId, intentType, payload);
  } finally {
    client.destroy();
  }
}

/** @deprecated Use serverSubmitIntent(). */
export async function serverIntent(
  streamId: string,
  entityId: string,
  intentType: string,
  payload: Record<string, unknown>,
  config?: CausetEnvConfig,
) {
  return serverSubmitIntent(streamId, entityId, intentType, payload, config);
}

export async function serverRunQuery(
  querySlug: string,
  input?: Record<string, unknown> | null,
  config?: CausetEnvConfig & { limit?: number; cursor?: string; includeTotal?: boolean },
) {
  const client = createServerCausetClient(config);
  await client.init();
  try {
    return await client.runQuery(querySlug, input, {
      limit: config?.limit,
      cursor: config?.cursor,
      includeTotal: config?.includeTotal,
    });
  } finally {
    client.destroy();
  }
}
