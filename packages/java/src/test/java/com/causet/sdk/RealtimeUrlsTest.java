package com.causet.sdk;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RealtimeUrlsTest {
    @Test
    void deriveWsUrl_sandbox() {
        assertEquals("wss://sandbox.realtime.causet.cloud/ws",
                RealtimeUrls.deriveWsUrl("https://sandbox.api.causet.cloud"));
    }

    @Test
    void deriveRealtimeUrl_sandbox() {
        assertEquals("https://sandbox.realtime.causet.cloud",
                RealtimeUrls.deriveRealtimeUrl("https://sandbox.api.causet.cloud"));
    }

    @Test
    void deriveWsUrl_https() {
        assertEquals("wss://api.example.com/ws", RealtimeUrls.deriveWsUrl("https://api.example.com"));
    }

    @Test
    void buildStreamEventsUrl_includesFork() {
        CausetConfig cfg = new CausetConfig();
        cfg.platformSlug = "plat";
        cfg.appSlug = "app";
        cfg.forkId = "sandbox";
        String url = RealtimeUrls.buildStreamEventsUrl(
                "https://api.example.com", cfg, "orders:1", 10, "jwt", null);
        assertTrue(url.contains("fork_id=sandbox"));
        assertTrue(url.contains("from_cursor=10"));
    }
}
