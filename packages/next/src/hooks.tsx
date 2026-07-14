'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CausetClient, type CausetClientOptions, type QueryResult } from '@causet/sdk-core';

const CausetContext = createContext<CausetClient | null>(null);

export interface CausetProviderProps {
  options: CausetClientOptions;
  children: ReactNode;
}

/** Client-side provider — mount once in a client component tree. */
export function CausetProvider({ options, children }: CausetProviderProps) {
  const client = useMemo(() => new CausetClient(options), [JSON.stringify(options)]);

  useEffect(() => {
    void client.init();
    return () => client.destroy();
  }, [client]);

  return <CausetContext.Provider value={client}>{children}</CausetContext.Provider>;
}

export function useCausetClient(): CausetClient {
  const client = useContext(CausetContext);
  if (!client) {
    throw new Error('useCausetClient must be used within CausetProvider');
  }
  return client;
}

export function useCausetQuery(
  querySlug: string,
  input?: Record<string, unknown> | null,
  opts?: { limit?: number; includeTotal?: boolean },
) {
  const client = useCausetClient();
  const [data, setData] = useState<QueryResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const inputKey = JSON.stringify(input ?? {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .runQuery(querySlug, input, opts)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, querySlug, inputKey, opts?.limit, opts?.includeTotal]);

  const refresh = useCallback(() => {
    setLoading(true);
    return client
      .runQuery(querySlug, input, opts)
      .then(setData)
      .finally(() => setLoading(false));
  }, [client, querySlug, input, opts]);

  return { data, error, loading, refresh };
}

export function useCausetIntent() {
  const client = useCausetClient();
  const [pending, setPending] = useState(false);

  const emit = useCallback(
    async (
      streamId: string,
      entityId: string,
      intentType: string,
      payload: Record<string, unknown>,
    ) => {
      setPending(true);
      try {
        return await client.emit(streamId, entityId, intentType, payload);
      } finally {
        setPending(false);
      }
    },
    [client],
  );

  const emitStream = useCallback(
    (
      streamId: string,
      entityId: string,
      intentType: string,
      payload: Record<string, unknown>,
      onEvent: Parameters<CausetClient['emitStream']>[4],
    ) => client.emitStream(streamId, entityId, intentType, payload, onEvent),
    [client],
  );

  return { emit, emitStream, pending };
}

/** Subscribe to entity state + optional WebSocket stream. */
export function useCausetEntity(streamId: string, entityId: string, connectWs = false) {
  const client = useCausetClient();
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;
    void client.subscribe(streamId, entityId).then(() => {
      if (mounted) setState(client.getState(streamId, entityId));
    });
    unsubRef.current = client.on('state', (ev) => {
      const e = ev as { streamId?: string; entityId?: string; state?: Record<string, unknown> };
      if (e.streamId === streamId && e.entityId === entityId) {
        setState(e.state ?? null);
      }
    });
    if (connectWs) {
      void client.connectStream(streamId);
    }
    return () => {
      mounted = false;
      unsubRef.current?.();
      client.unsubscribe(streamId, entityId);
      if (connectWs) client.disconnectStream();
    };
  }, [client, streamId, entityId, connectWs]);

  return state;
}

export { CausetClient, type CausetClientOptions, type QueryResult };
