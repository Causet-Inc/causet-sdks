package com.causet.sdk;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Minimal thread-safe pub/sub bus, mirroring the Emitter used by the
 * TypeScript, Python, and Laravel SDKs (on/emit).
 */
public class Emitter {
    private final Map<String, CopyOnWriteArrayList<Consumer<Object>>> handlers = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<BiConsumer<String, Object>> wildcards = new CopyOnWriteArrayList<>();

    /** Registers handler for eventType. Returns a Runnable that unsubscribes it. */
    public Runnable on(String eventType, Consumer<Object> handler) {
        List<Consumer<Object>> list = handlers.computeIfAbsent(eventType, k -> new CopyOnWriteArrayList<>());
        list.add(handler);
        return () -> list.remove(handler);
    }

    /** Registers a wildcard handler invoked for every emitted event. */
    public Runnable onAny(BiConsumer<String, Object> handler) {
        wildcards.add(handler);
        return () -> wildcards.remove(handler);
    }

    /** Invokes every handler registered for eventType, then every wildcard handler. */
    public void emit(String eventType, Object data) {
        for (Consumer<Object> h : handlers.getOrDefault(eventType, EMPTY)) {
            try {
                h.accept(data);
            } catch (RuntimeException ignored) {
                /* a handler error must not break the caller (e.g. stream read loop) */
            }
        }
        for (BiConsumer<String, Object> h : wildcards) {
            try {
                h.accept(eventType, data);
            } catch (RuntimeException ignored) {
                /* ignored */
            }
        }
    }

    private static final CopyOnWriteArrayList<Consumer<Object>> EMPTY = new CopyOnWriteArrayList<>();
}
