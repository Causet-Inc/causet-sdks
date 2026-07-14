'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, } from 'react';
import { CausetClient } from '@causet/sdk-core';
const CausetContext = createContext(null);
/** Client-side provider — mount once in a client component tree. */
export function CausetProvider({ options, children }) {
    const client = useMemo(() => new CausetClient(options), [JSON.stringify(options)]);
    useEffect(() => {
        void client.init();
        return () => client.destroy();
    }, [client]);
    return _jsx(CausetContext.Provider, { value: client, children: children });
}
export function useCausetClient() {
    const client = useContext(CausetContext);
    if (!client) {
        throw new Error('useCausetClient must be used within CausetProvider');
    }
    return client;
}
export function useCausetQuery(querySlug, input, opts) {
    const client = useCausetClient();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
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
            if (!cancelled)
                setError(e);
        })
            .finally(() => {
            if (!cancelled)
                setLoading(false);
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
    const emit = useCallback(async (streamId, entityId, intentType, payload) => {
        setPending(true);
        try {
            return await client.emit(streamId, entityId, intentType, payload);
        }
        finally {
            setPending(false);
        }
    }, [client]);
    const emitStream = useCallback((streamId, entityId, intentType, payload, onEvent) => client.emitStream(streamId, entityId, intentType, payload, onEvent), [client]);
    return { emit, emitStream, pending };
}
/** Subscribe to entity state + optional WebSocket stream. */
export function useCausetEntity(streamId, entityId, connectWs = false) {
    const client = useCausetClient();
    const [state, setState] = useState(null);
    const unsubRef = useRef(null);
    useEffect(() => {
        let mounted = true;
        void client.subscribe(streamId, entityId).then(() => {
            if (mounted)
                setState(client.getState(streamId, entityId));
        });
        unsubRef.current = client.on('state', (ev) => {
            const e = ev;
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
            if (connectWs)
                client.disconnectStream();
        };
    }, [client, streamId, entityId, connectWs]);
    return state;
}
export { CausetClient };
