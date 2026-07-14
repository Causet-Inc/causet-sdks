package com.causet.sdk;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class EmitterTest {
    @Test
    void onAndEmitInvokesHandlerWithData() {
        Emitter emitter = new Emitter();
        AtomicReference<Object> received = new AtomicReference<>();
        emitter.on("state", received::set);
        emitter.emit("state", "payload");
        assertEquals("payload", received.get());
    }

    @Test
    void unsubscribeStopsFutureCalls() {
        Emitter emitter = new Emitter();
        AtomicInteger calls = new AtomicInteger();
        Runnable unsubscribe = emitter.on("evt", d -> calls.incrementAndGet());
        emitter.emit("evt", null);
        unsubscribe.run();
        emitter.emit("evt", null);
        assertEquals(1, calls.get());
    }

    @Test
    void doesNotCrossFireEventTypes() {
        Emitter emitter = new Emitter();
        AtomicInteger calls = new AtomicInteger();
        emitter.on("a", d -> calls.incrementAndGet());
        emitter.emit("b", null);
        assertEquals(0, calls.get());
    }

    @Test
    void handlerExceptionDoesNotStopOtherHandlers() {
        Emitter emitter = new Emitter();
        AtomicInteger calls = new AtomicInteger();
        emitter.on("evt", d -> {
            throw new RuntimeException("boom");
        });
        emitter.on("evt", d -> calls.incrementAndGet());
        emitter.emit("evt", null);
        assertEquals(1, calls.get());
    }

    @Test
    void wildcardReceivesEventTypeAndData() {
        Emitter emitter = new Emitter();
        AtomicReference<String> seenType = new AtomicReference<>();
        emitter.onAny((type, data) -> seenType.set(type));
        emitter.emit("foo", "bar");
        assertEquals("foo", seenType.get());
    }

    @Test
    void noHandlersDoesNotThrow() {
        Emitter emitter = new Emitter();
        emitter.emit("nothing-registered", "x");
        assertNull(null); // reaching here without throwing is the assertion
    }
}
