package com.causet.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CausetClientTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private MockWebServer server;

    @AfterEach
    void tearDown() throws Exception {
        if (server != null) server.shutdown();
    }

    private CausetConfig configFor(MockWebServer server) {
        CausetConfig cfg = new CausetConfig();
        cfg.apiUrl = server.url("/").toString();
        cfg.platformSlug = "plat";
        cfg.appSlug = "app";
        cfg.forkId = "sandbox";
        cfg.bearerToken = "test-token";
        cfg.realtimeUrl = server.url("/").toString();
        return cfg;
    }

    @Test
    void fetchStateParsesSnapshotJsonAndVersion() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("{\"snapshotJson\":{\"quantity\":10},\"snapshotVersion\":3}"));

        CausetClient client = new CausetClient(configFor(server));
        EntityState result = client.fetchState("sku_stream", "sku-1");

        assertEquals(10, result.getState().get("quantity").asInt());
        assertEquals(3, result.getCursor());
    }

    @Test
    void subscribeGetStateUnsubscribe() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("{\"snapshotJson\":{\"quantity\":10},\"snapshotVersion\":1}"));

        CausetClient client = new CausetClient(configFor(server));
        AtomicInteger stateEvents = new AtomicInteger();
        client.on("state", d -> stateEvents.incrementAndGet());

        client.subscribe("sku_stream", "sku-1");
        assertEquals(10, client.getState("sku_stream", "sku-1").get("quantity").asInt());
        assertEquals(1, stateEvents.get());

        client.unsubscribe("sku_stream", "sku-1");
        assertNull(client.getState("sku_stream", "sku-1"));
    }

    @Test
    void emitRefreshesSubscriptionViaStatePatchAndEmitsPatchOp() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("{\"snapshotJson\":{\"quantity\":10},\"snapshotVersion\":1}"));
        server.enqueue(new MockResponse().setBody(
                "{\"accepted\":true,\"executionId\":\"exec-1\","
                        + "\"statePatch\":[{\"op\":\"replace\",\"path\":\"/quantity\",\"value\":5}]}"));

        CausetClient client = new CausetClient(configFor(server));
        client.subscribe("sku_stream", "sku-1");

        AtomicInteger patchEvents = new AtomicInteger();
        client.on("patch_op", d -> patchEvents.incrementAndGet());

        JsonNode result = client.intent("sku_stream", "sku-1", "adjust_stock", Map.of("qty", -5));

        assertEquals("exec-1", result.get("executionId").asText());
        assertEquals(1, patchEvents.get());
        assertEquals(5, client.getState("sku_stream", "sku-1").get("quantity").asInt());
    }

    @Test
    void selectFiresImmediatelyAndOnChange() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("{\"snapshotJson\":{\"quantity\":10},\"snapshotVersion\":1}"));
        server.enqueue(new MockResponse().setBody(
                "{\"accepted\":true,\"statePatch\":[{\"op\":\"replace\",\"path\":\"/quantity\",\"value\":95}]}"));

        CausetClient client = new CausetClient(configFor(server));
        client.subscribe("sku_stream", "sku-1");

        List<Integer> values = new CopyOnWriteArrayList<>();
        client.select("sku_stream", "sku-1", state -> state.get("quantity").asInt(), v -> values.add((Integer) v));

        client.intent("sku_stream", "sku-1", "adjust_stock", Map.of());

        assertEquals(List.of(10, 95), values);
    }

    @Test
    void runQueryStringifiesInputAndFlattensItems() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody(
                "{\"items\":[{\"track.title\":\"Song A\",\"track.genres\":[\"Pop\"]}],\"next_cursor\":null}"));

        CausetClient client = new CausetClient(configFor(server));
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("genres", List.of("Pop", "Rock"));
        input.put("active", true);

        CausetClient.QueryOptions opts = new CausetClient.QueryOptions();
        opts.limit = 10;
        opts.includeTotal = true;

        JsonNode result = client.runQuery("top_tracks", input, opts);

        RecordedRequest req = server.takeRequest();
        assertEquals("/v1/platforms/plat/applications/app/forks/sandbox/queries/top_tracks/run", req.getPath());
        JsonNode body = MAPPER.readTree(req.getBody().readUtf8());
        assertEquals("[\"Pop\",\"Rock\"]", body.get("input").get("genres").asText());
        assertEquals("true", body.get("input").get("active").asText());
        assertEquals(10, body.get("limit").asInt());
        assertTrue(body.get("include_total").asBoolean());

        JsonNode items = result.get("items");
        assertEquals("Song A", items.get(0).get("title").asText());
    }

    @Test
    void listQueriesGetQueryDefinitionListProjections() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("[{\"slug\":\"q1\"}]"));
        server.enqueue(new MockResponse().setBody("{\"slug\":\"q1\",\"params\":[]}"));
        server.enqueue(new MockResponse().setBody("[{\"slug\":\"p1\"}]"));

        CausetClient client = new CausetClient(configFor(server));
        assertEquals(1, client.listQueries().size());
        assertEquals("q1", client.getQueryDefinition("q1").get("slug").asText());
        assertEquals(1, client.listProjections().size());
    }

    @Test
    void listEntitiesSendsFilters() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("{\"entityIds\":[\"sku-1\"]}"));

        CausetClient client = new CausetClient(configFor(server));
        CausetClient.ListEntitiesOptions opts = new CausetClient.ListEntitiesOptions();
        opts.streamName = "sku_stream";
        opts.limit = 25;
        JsonNode result = client.listEntities(opts);

        RecordedRequest req = server.takeRequest();
        assertTrue(req.getPath().contains("forkId=sandbox"));
        assertTrue(req.getPath().contains("streamName=sku_stream"));
        assertTrue(req.getPath().contains("limit=25"));
        assertEquals(1, result.get("entityIds").size());
    }

    @Test
    void intentStreamDeliversEvents() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: START\ndata: {\"status\":\"START\"}\n\nevent: COMPLETE\ndata: {\"status\":\"COMPLETE\"}\n\n"));

        CausetClient client = new CausetClient(configFor(server));
        List<CausetClient.SseEvent> events = new CopyOnWriteArrayList<>();
        client.intentStream("sku_stream", "sku-1", "adjust_stock", Map.of("qty", 5), events::add);

        assertEquals(2, events.size());
        assertEquals("START", events.get(0).event);
        assertEquals("COMPLETE", events.get(1).event);
        assertEquals("COMPLETE", events.get(1).data.get("status").asText());

        RecordedRequest req = server.takeRequest();
        assertEquals("/v1/runtime/stream/platforms/plat/applications/app/intents/submit", req.getPath());
        assertEquals("text/event-stream", req.getHeader("Accept"));
    }

    @Test
    void connectStreamSseAppliesPatchToSubscribedEntity() throws Exception {
        server = new MockWebServer();
        server.start();
        server.enqueue(new MockResponse().setBody("{\"snapshotJson\":{\"quantity\":10},\"snapshotVersion\":1}"));
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("data: {\"stream_id\":\"sku_stream\",\"entity_id\":\"sku-1\","
                        + "\"patch\":[{\"op\":\"replace\",\"path\":\"/quantity\",\"value\":95}]}\n\n"));

        CausetClient client = new CausetClient(configFor(server));
        client.subscribe("sku_stream", "sku-1");

        CountDownLatch patchLatch = new CountDownLatch(1);
        CountDownLatch connectedLatch = new CountDownLatch(1);
        client.on("patch_op", d -> patchLatch.countDown());
        client.on("stream_connected", d -> connectedLatch.countDown());

        CausetClient.StreamConnectOptions opts = new CausetClient.StreamConnectOptions();
        opts.transport = StreamTransport.SSE;
        CompletableFuture<String> connId = client.connectStream("sku_stream", opts, ev -> { });

        assertEquals("sse-sku_stream", connId.get(5, TimeUnit.SECONDS));
        assertTrue(connectedLatch.await(5, TimeUnit.SECONDS));
        assertTrue(patchLatch.await(5, TimeUnit.SECONDS));
        assertEquals(95, client.getState("sku_stream", "sku-1").get("quantity").asInt());

        client.disconnectStream();
    }

    @Test
    void getTokenReturnsBearerTokenAndInitIsNoOp() throws Exception {
        CausetConfig cfg = new CausetConfig();
        cfg.apiUrl = "https://api.example.com";
        cfg.platformSlug = "plat";
        cfg.appSlug = "app";
        cfg.bearerToken = "test-token";
        CausetClient client = new CausetClient(cfg);
        client.init();
        assertEquals("test-token", client.getToken());
    }
}
