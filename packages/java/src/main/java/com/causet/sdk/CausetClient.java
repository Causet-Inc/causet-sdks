package com.causet.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.time.Duration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Java SDK client for the Causet SaaS API. Method names mirror the other
 * Causet SDKs (TypeScript, Python, Go, Laravel) using Java's camelCase
 * convention: {@code emit}, {@code emitStream}, {@code subscribe}/
 * {@code unsubscribe}/{@code getState}, {@code on}, {@code select},
 * {@code runQuery}, {@code connectStream}/{@code disconnectStream}, etc.
 */
public class CausetClient implements AutoCloseable {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final MediaType JSON = MediaType.get("application/json");

    private final CausetConfig config;
    private final OkHttpClient http;
    private final ApiKeyTokenManager tokenManager;
    private final Emitter emitter = new Emitter();
    private final Map<String, Subscription> subscriptions = new ConcurrentHashMap<>();
    private final List<SelectorEntry> selectors = new CopyOnWriteArrayList<>();

    private WebSocket activeWs;
    private Thread activeSseThread;
    private volatile boolean sseRunning;

    public CausetClient(CausetConfig config) {
        this.config = config;
        config.normalize();
        this.http = new OkHttpClient.Builder()
                .callTimeout(Duration.ofSeconds(120))
                .readTimeout(0, TimeUnit.SECONDS)
                .build();
        this.tokenManager = (config.apiKey != null && !config.apiKey.isBlank())
                ? new ApiKeyTokenManager(config.apiUrl, config.apiKey)
                : null;
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    public String getToken() throws IOException {
        if (tokenManager != null) {
            return tokenManager.getToken();
        }
        if (config.bearerToken != null && !config.bearerToken.isBlank()) {
            return config.bearerToken;
        }
        throw new CausetAuthException("No apiKey or bearerToken configured");
    }

    /** Eagerly exchanges the API key for a JWT. No-op with a static bearerToken. */
    public void init() throws IOException {
        if (tokenManager != null) {
            tokenManager.getToken();
        }
    }

    @Override
    public void close() {
        disconnectStream();
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    /**
     * Registers handler for eventType ("state", "patch_op", "stream_event",
     * "stream_connected", "stream_disconnected", "emitted", "error").
     * Returns a {@link Runnable} that unsubscribes it.
     */
    public Runnable on(String eventType, Consumer<Object> handler) {
        return emitter.on(eventType, handler);
    }

    // ------------------------------------------------------------------
    // Entity state (subscribe / cache / select)
    // ------------------------------------------------------------------

    /** Fetches entity state and caches it for getState/select. Emits "state". */
    public void subscribe(String streamId, String entityId) throws IOException {
        EntityState result = fetchState(streamId, entityId);
        Subscription sub = new Subscription();
        sub.state = asObjectNode(result.getState());
        sub.cursor = result.getCursor();
        subscriptions.put(subKey(streamId, entityId), sub);
        emitter.emit("state", stateEventPayload(streamId, entityId));
        notifySelectors(streamId, entityId);
    }

    /** Removes cached state and any selectors watching that entity. */
    public void unsubscribe(String streamId, String entityId) {
        subscriptions.remove(subKey(streamId, entityId));
        selectors.removeIf(e -> e.streamId.equals(streamId) && e.entityId.equals(entityId));
    }

    /** Returns the cached state for a subscribed entity (deep copy), or null. */
    public JsonNode getState(String streamId, String entityId) {
        Subscription sub = subscriptions.get(subKey(streamId, entityId));
        if (sub == null) return null;
        synchronized (sub) {
            return sub.state.deepCopy();
        }
    }

    /**
     * Watches derived state for one entity: selector runs against cached
     * state, handler fires whenever its JSON-compared output changes. Fires
     * immediately if state is already cached. Returns an unsubscribe {@link Runnable}.
     */
    public Runnable select(String streamId, String entityId, Function<JsonNode, Object> selector, Consumer<Object> handler) {
        SelectorEntry entry = new SelectorEntry(streamId, entityId, selector, handler);
        JsonNode state = getState(streamId, entityId);
        if (state != null) {
            entry.lastValue = selector.apply(state);
            handler.accept(entry.lastValue);
        }
        selectors.add(entry);
        return () -> selectors.remove(entry);
    }

    private void notifySelectors(String streamId, String entityId) {
        JsonNode state = getState(streamId, entityId);
        if (state == null) return;
        for (SelectorEntry entry : selectors) {
            if (!entry.streamId.equals(streamId) || !entry.entityId.equals(entityId)) continue;
            Object next = entry.selector.apply(state);
            if (!Objects.equals(jsonOf(next), jsonOf(entry.lastValue))) {
                entry.lastValue = next;
                entry.handler.accept(next);
            }
        }
    }

    private Map<String, Object> stateEventPayload(String streamId, String entityId) {
        Map<String, Object> m = new HashMap<>();
        m.put("streamId", streamId);
        m.put("entityId", entityId);
        m.put("state", getState(streamId, entityId));
        return m;
    }

    private static String subKey(String streamId, String entityId) {
        return streamId + ":" + entityId;
    }

    private static ObjectNode asObjectNode(JsonNode node) {
        return (node != null && node.isObject()) ? (ObjectNode) node : MAPPER.createObjectNode();
    }

    private static String jsonOf(Object v) {
        try {
            return MAPPER.writeValueAsString(v);
        } catch (IOException e) {
            return String.valueOf(v);
        }
    }

    private static class Subscription {
        ObjectNode state;
        long cursor;
    }

    private static class SelectorEntry {
        final String streamId;
        final String entityId;
        final Function<JsonNode, Object> selector;
        final Consumer<Object> handler;
        Object lastValue;

        SelectorEntry(String streamId, String entityId, Function<JsonNode, Object> selector, Consumer<Object> handler) {
            this.streamId = streamId;
            this.entityId = entityId;
            this.selector = selector;
            this.handler = handler;
        }
    }

    // ------------------------------------------------------------------
    // REST: entity state
    // ------------------------------------------------------------------

    /** One-shot, uncached read of entity state + cursor. */
    public EntityState fetchState(String streamId, String entityId) throws IOException {
        String url = base()
                + "/entities/" + pathEncode(streamId) + "/" + pathEncode(entityId) + "/state";
        JsonNode data = getJson(url, Map.of("forkId", config.forkId));
        return parseSnapshot(data);
    }

    private static EntityState parseSnapshot(JsonNode data) {
        JsonNode state = data;
        JsonNode raw = data.get("snapshotJson");
        if (raw != null && !raw.isNull()) {
            if (raw.isTextual()) {
                try {
                    state = MAPPER.readTree(raw.asText());
                } catch (IOException e) {
                    state = data;
                }
            } else {
                state = raw;
            }
        }
        long cursor = 0;
        if (data.hasNonNull("snapshotVersion")) {
            cursor = data.get("snapshotVersion").asLong(0);
        } else if (data.hasNonNull("watermark")) {
            cursor = data.get("watermark").asLong(0);
        }
        return new EntityState(state, cursor);
    }

    // ------------------------------------------------------------------
    // Intents
    // ------------------------------------------------------------------

    public JsonNode emit(String streamId, String entityId, String intentType, Map<String, Object> payload) throws IOException {
        return emit(streamId, entityId, intentType, payload, null);
    }

    /**
     * Submits an intent (sync) and returns the raw response
     * (accepted/executionId/error/statePatch). If entityId is subscribed
     * (see {@link #subscribe}), the cached state is refreshed via statePatch
     * or a refetch, and "state"/"patch_op" events are emitted.
     */
    public JsonNode emit(String streamId, String entityId, String intentType, Map<String, Object> payload, String intentId) throws IOException {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("intentId", (intentId == null || intentId.isBlank()) ? UUID.randomUUID().toString() : intentId);
        body.put("forkId", config.forkId);
        body.put("streamId", streamId);
        body.put("entityId", entityId);
        body.put("intentType", intentType);
        body.set("payload", MAPPER.valueToTree(payload));

        JsonNode result = postJson(runtimeBase() + "/intents/submit", body);
        if (result.path("accepted").asBoolean(false)) {
            refreshSubscriptionAfterEmit(streamId, entityId, result);
        }
        return result;
    }

    private void refreshSubscriptionAfterEmit(String streamId, String entityId, JsonNode result) {
        Subscription sub = subscriptions.get(subKey(streamId, entityId));
        if (sub == null) return;

        JsonNode patch = result.get("statePatch");
        if (patch != null && !patch.isNull()) {
            JsonNode ops = patch;
            if (patch.isTextual()) {
                try {
                    ops = MAPPER.readTree(patch.asText());
                } catch (IOException e) {
                    ops = null;
                }
            }
            if (ops != null && ops.isArray() && ops.size() > 0) {
                synchronized (sub) {
                    StatePatch.apply(sub.state, ops);
                }
                emitter.emit("patch_op", patchEventPayload(streamId, entityId, ops));
            }
        } else {
            try {
                EntityState fresh = fetchState(streamId, entityId);
                synchronized (sub) {
                    sub.state = asObjectNode(fresh.getState());
                    sub.cursor = fresh.getCursor();
                }
            } catch (IOException ignored) {
                // keep the stale cache rather than throwing from a post-emit refresh path
            }
        }

        emitter.emit("state", stateEventPayload(streamId, entityId));
        notifySelectors(streamId, entityId);
    }

    private Map<String, Object> patchEventPayload(String streamId, String entityId, Object ops) {
        Map<String, Object> m = new HashMap<>();
        m.put("streamId", streamId);
        m.put("entityId", entityId);
        m.put("ops", ops);
        return m;
    }

    /**
     * Submits an intent and streams its execution progress (START, COMPLETE,
     * ERROR, …) via SSE. Blocks the calling thread until the stream closes;
     * run on its own thread/executor for non-blocking use.
     */
    public void emitStream(String streamId, String entityId, String intentType, Map<String, Object> payload, Consumer<SseEvent> onEvent) throws IOException {
        emitStream(streamId, entityId, intentType, payload, onEvent, null);
    }

    /**
     * Overload of {@link #emitStream} that accepts an explicit idempotency
     * key. Parameter order mirrors the other Causet SDKs: (..., payload,
     * onEvent, intentId).
     */
    public void emitStream(String streamId, String entityId, String intentType, Map<String, Object> payload, Consumer<SseEvent> onEvent, String intentId) throws IOException {
        String token = getToken();
        ObjectNode body = MAPPER.createObjectNode();
        body.put("intentId", (intentId == null || intentId.isBlank()) ? UUID.randomUUID().toString() : intentId);
        body.put("forkId", config.forkId);
        body.put("streamId", streamId);
        body.put("entityId", entityId);
        body.put("intentType", intentType);
        body.set("payload", MAPPER.valueToTree(payload));

        Request req = new Request.Builder()
                .url(runtimeStreamBase() + "/intents/submit")
                .header("Authorization", "Bearer " + token)
                .header("Accept", "text/event-stream")
                .post(RequestBody.create(MAPPER.writeValueAsString(body), JSON))
                .build();
        try (Response resp = http.newCall(req).execute()) {
            if (!resp.isSuccessful()) {
                throw new CausetApiException(resp.code(), resp.body() != null ? resp.body().string() : resp.message());
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(resp.body().byteStream()));
            StringBuilder block = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    emitIntentSseBlock(block.toString(), onEvent);
                    block.setLength(0);
                    continue;
                }
                block.append(line).append('\n');
            }
            if (block.length() > 0) {
                emitIntentSseBlock(block.toString(), onEvent);
            }
        }
    }

    private void emitIntentSseBlock(String block, Consumer<SseEvent> onEvent) {
        if (block.isBlank()) return;
        String id = null;
        String eventType = null;
        StringBuilder data = new StringBuilder();
        for (String line : block.split("\n")) {
            if (line.startsWith("id:")) {
                id = line.substring(3).trim();
            } else if (line.startsWith("event:")) {
                eventType = line.substring(6).trim();
            } else if (line.startsWith("data:")) {
                if (data.length() > 0) data.append('\n');
                data.append(line.substring(5));
            }
        }
        if (data.length() == 0) return;
        JsonNode parsed;
        try {
            parsed = MAPPER.readTree(data.toString());
        } catch (IOException e) {
            parsed = MAPPER.getNodeFactory().textNode(data.toString().trim());
        }
        onEvent.accept(new SseEvent(id, eventType, parsed));
    }

    /** A single parsed Server-Sent Event (data is JSON-decoded when possible). */
    public static class SseEvent {
        public final String id;
        public final String event;
        public final JsonNode data;

        public SseEvent(String id, String event, JsonNode data) {
            this.id = id;
            this.event = event;
            this.data = data;
        }
    }

    // ------------------------------------------------------------------
    // Queries & projections
    // ------------------------------------------------------------------

    public static class QueryOptions {
        public Integer limit;
        public Integer offset;
        public String cursor;
        public boolean includeTotal;
    }

    public static class ListEntitiesOptions {
        public String streamName;
        public String searchPrefix;
        public String cursor;
        public Integer limit;
    }

    /**
     * Runs a named query via POST .../forks/{forkId}/queries/{slug}/run.
     * Input values are stringified for the API (lists/maps become JSON
     * strings). {@code options.limit}/{@code offset}/{@code cursor} are
     * pagination for the HTTP layer, independent of any DSL input parameter
     * of the same name.
     */
    public JsonNode runQuery(String querySlug, Map<String, Object> input, QueryOptions options) throws IOException {
        QueryOptions opts = options != null ? options : new QueryOptions();
        String url = base() + "/forks/" + pathEncode(config.forkId) + "/queries/" + pathEncode(querySlug) + "/run";
        ObjectNode body = MAPPER.createObjectNode();
        body.set("input", stringifyQueryInput(input));
        if (opts.limit != null) body.put("limit", opts.limit);
        if (opts.cursor != null) {
            body.put("cursor", opts.cursor);
        } else if (opts.offset != null && opts.offset > 0) {
            body.put("offset", opts.offset);
        }
        if (opts.includeTotal) body.put("include_total", true);

        JsonNode result = postJson(url, body);
        if (result == null || result.isNull() || result.isMissingNode()) {
            ObjectNode empty = MAPPER.createObjectNode();
            empty.putArray("items");
            return empty;
        }
        if (result.get("items") instanceof ArrayNode) {
            ((ObjectNode) result).set("items", flattenItems((ArrayNode) result.get("items")));
        }
        return result;
    }

    public JsonNode listQueries() throws IOException {
        String url = base() + "/forks/" + pathEncode(config.forkId) + "/queries";
        return getJson(url, null);
    }

    public JsonNode getQueryDefinition(String querySlug) throws IOException {
        String url = base() + "/forks/" + pathEncode(config.forkId) + "/queries/" + pathEncode(querySlug);
        return getJson(url, null);
    }

    public JsonNode listProjections() throws IOException {
        String url = base() + "/forks/" + pathEncode(config.forkId) + "/projections";
        return getJson(url, null);
    }

    public JsonNode listEntities(ListEntitiesOptions options) throws IOException {
        ListEntitiesOptions opts = options != null ? options : new ListEntitiesOptions();
        Map<String, String> params = new HashMap<>();
        params.put("forkId", config.forkId);
        if (opts.streamName != null) params.put("streamName", opts.streamName);
        if (opts.searchPrefix != null) params.put("searchPrefix", opts.searchPrefix);
        if (opts.cursor != null) params.put("cursor", opts.cursor);
        if (opts.limit != null) params.put("limit", String.valueOf(opts.limit));
        return getJson(base() + "/entities", params);
    }

    private static ObjectNode stringifyQueryInput(Map<String, Object> raw) {
        ObjectNode out = MAPPER.createObjectNode();
        if (raw == null) return out;
        for (Map.Entry<String, Object> e : raw.entrySet()) {
            Object v = e.getValue();
            if (v == null) continue;
            if (v instanceof String) {
                out.put(e.getKey(), (String) v);
            } else if (v instanceof Boolean) {
                out.put(e.getKey(), ((Boolean) v) ? "true" : "false");
            } else {
                out.put(e.getKey(), jsonOf(v));
            }
        }
        return out;
    }

    private static ObjectNode flattenRow(ObjectNode row) {
        ObjectNode out = MAPPER.createObjectNode();
        Iterator<Map.Entry<String, JsonNode>> fields = row.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> e = fields.next();
            String key = e.getKey();
            int dot = key.lastIndexOf('.');
            String shortKey = dot >= 0 ? key.substring(dot + 1) : key;
            out.set(shortKey, e.getValue());
        }
        return out;
    }

    private static ArrayNode flattenItems(ArrayNode items) {
        ArrayNode out = MAPPER.createArrayNode();
        for (JsonNode item : items) {
            out.add(item.isObject() ? flattenRow((ObjectNode) item) : item);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Low-level HTTP helpers
    // ------------------------------------------------------------------

    private static String pathEncode(String segment) {
        HttpUrl encoded = HttpUrl.parse("http://_/").newBuilder().addPathSegment(segment).build();
        return encoded.pathSegments().get(0);
    }

    private String base() {
        return config.apiUrl.replaceAll("/+$", "")
                + "/v1/platforms/" + pathEncode(config.platformSlug)
                + "/applications/" + pathEncode(config.appSlug);
    }

    private String runtimeBase() {
        return config.apiUrl.replaceAll("/+$", "")
                + "/v1/runtime/platforms/" + pathEncode(config.platformSlug)
                + "/applications/" + pathEncode(config.appSlug);
    }

    private String runtimeStreamBase() {
        return config.apiUrl.replaceAll("/+$", "")
                + "/v1/runtime/stream/platforms/" + pathEncode(config.platformSlug)
                + "/applications/" + pathEncode(config.appSlug);
    }

    private JsonNode getJson(String url, Map<String, String> params) throws IOException {
        String token = getToken();
        HttpUrl parsed = HttpUrl.parse(url);
        if (parsed == null) {
            throw new IOException("Invalid URL: " + url);
        }
        HttpUrl.Builder builder = parsed.newBuilder();
        if (params != null) {
            for (Map.Entry<String, String> e : params.entrySet()) {
                if (e.getValue() != null) {
                    builder.addQueryParameter(e.getKey(), e.getValue());
                }
            }
        }
        Request req = new Request.Builder()
                .url(builder.build())
                .header("Authorization", "Bearer " + token)
                .get()
                .build();
        try (Response resp = http.newCall(req).execute()) {
            if (!resp.isSuccessful()) {
                throw new CausetApiException(resp.code(), resp.body() != null ? resp.body().string() : resp.message());
            }
            return readJsonBody(resp);
        }
    }

    private JsonNode postJson(String url, Object body) throws IOException {
        String token = getToken();
        Request req = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(MAPPER.writeValueAsString(body), JSON))
                .build();
        try (Response resp = http.newCall(req).execute()) {
            if (!resp.isSuccessful()) {
                throw new CausetApiException(resp.code(), resp.body() != null ? resp.body().string() : resp.message());
            }
            return readJsonBody(resp);
        }
    }

    private static JsonNode readJsonBody(Response resp) throws IOException {
        String text = resp.body() != null ? resp.body().string() : "";
        if (text.isBlank()) return NullNode.getInstance();
        return MAPPER.readTree(text);
    }

    // ------------------------------------------------------------------
    // Real-time streaming (WebSocket / SSE)
    // ------------------------------------------------------------------

    /**
     * Connects to a live stream (WebSocket or SSE). streamId may be
     * streamType or streamType:entityId. In addition to onEvent, the client
     * emits "stream_event"/"patch_op"/"state"/"emitted" via {@link #on}, and
     * "stream_connected"/"stream_disconnected"/"error" for connection lifecycle.
     */
    public CompletableFuture<String> connectStream(
            String streamId,
            StreamConnectOptions options,
            Consumer<JsonNode> onEvent) {
        StreamTransport mode = options != null && options.transport != null
                ? options.transport
                : config.streamTransport;
        long fromCursor = options != null ? options.fromCursor : 0;
        Consumer<JsonNode> wrapped = event -> {
            handleStreamEvent(streamId, event);
            if (onEvent != null) onEvent.accept(event);
        };
        if (mode == StreamTransport.SSE) {
            return connectStreamSse(streamId, fromCursor, wrapped);
        }
        return connectStreamWebSocket(streamId, fromCursor, wrapped);
    }

    private void handleStreamEvent(String streamId, JsonNode event) {
        Map<String, Object> streamEventPayload = new HashMap<>();
        streamEventPayload.put("streamId", streamId);
        streamEventPayload.put("event", event);
        emitter.emit("stream_event", streamEventPayload);

        String entityId = event.path("entity_id").asText(null);
        JsonNode patch = event.get("patch");
        if (patch != null && patch.isArray() && entityId != null) {
            Subscription sub = subscriptions.get(subKey(streamId, entityId));
            if (sub != null) {
                synchronized (sub) {
                    StatePatch.apply(sub.state, patch);
                }
                emitter.emit("patch_op", patchEventPayload(streamId, entityId, patch));
                emitter.emit("state", stateEventPayload(streamId, entityId));
                notifySelectors(streamId, entityId);
            }
        }

        JsonNode emits = event.get("emits");
        if (emits != null && emits.isArray()) {
            Map<String, Object> emittedPayload = new HashMap<>();
            emittedPayload.put("streamId", streamId);
            emittedPayload.put("entityId", entityId);
            emittedPayload.put("emits", emits);
            emitter.emit("emitted", emittedPayload);
        }
    }

    public void disconnectStream() {
        if (activeWs != null) {
            activeWs.close(1000, "client disconnect");
            activeWs = null;
        }
        sseRunning = false;
        if (activeSseThread != null) {
            activeSseThread.interrupt();
            activeSseThread = null;
        }
    }

    private CompletableFuture<String> connectStreamWebSocket(
            String streamId, long fromCursor, Consumer<JsonNode> onEvent) {
        CompletableFuture<String> welcome = new CompletableFuture<>();
        try {
            String token = getToken();
            HttpUrl.Builder url = HttpUrl.parse(config.wsUrl).newBuilder();
            if (config.apiKey != null && !config.apiKey.isBlank()) {
                url.addQueryParameter("api_key", config.apiKey);
            }
            if (token != null && !token.isBlank()) {
                url.addQueryParameter("token", token);
            }
            ObjectNode hello = MAPPER.createObjectNode();
            hello.put("type", "hello");
            hello.put("v", 1);
            hello.put("stream_id", streamId);
            hello.put("fork_id", config.forkId);
            ArrayNode subs = hello.putArray("subs");
            ObjectNode ledger = subs.addObject();
            ledger.put("channel", "ledger");
            ObjectNode state = subs.addObject();
            state.put("channel", "state");
            if (fromCursor > 0) {
                ledger.put("from_cursor", fromCursor);
                state.put("from_cursor", fromCursor);
            }

            activeWs = http.newWebSocket(
                    new Request.Builder().url(url.build())
                            .header("Authorization", "Bearer " + token)
                            .build(),
                    new WebSocketListener() {
                        @Override
                        public void onOpen(WebSocket webSocket, Response response) {
                            webSocket.send(hello.toString());
                        }

                        @Override
                        public void onMessage(WebSocket webSocket, String text) {
                            try {
                                JsonNode msg = MAPPER.readTree(text);
                                String type = msg.path("type").asText("");
                                if ("welcome".equals(type)) {
                                    String connId = msg.path("conn_id").asText("ws");
                                    welcome.complete(connId);
                                    Map<String, Object> payload = new HashMap<>();
                                    payload.put("streamId", streamId);
                                    payload.put("connId", connId);
                                    payload.put("transport", "websocket");
                                    emitter.emit("stream_connected", payload);
                                    return;
                                }
                                if ("error".equals(type)) {
                                    IOException err = new IOException(msg.path("message").asText("websocket error"));
                                    if (!welcome.isDone()) {
                                        welcome.completeExceptionally(err);
                                    }
                                    emitter.emit("error", err);
                                    return;
                                }
                                if ("pong".equals(type) || "redirect".equals(type)) {
                                    return;
                                }
                                if (msg.has("event_type") || msg.has("patch") || "event".equals(type)) {
                                    onEvent.accept(msg);
                                }
                            } catch (IOException e) {
                                if (!welcome.isDone()) {
                                    welcome.completeExceptionally(e);
                                }
                                emitter.emit("error", e);
                            }
                        }

                        @Override
                        public void onClosed(WebSocket webSocket, int code, String reason) {
                            Map<String, Object> payload = new HashMap<>();
                            payload.put("streamId", streamId);
                            payload.put("transport", "websocket");
                            emitter.emit("stream_disconnected", payload);
                        }

                        @Override
                        public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                            welcome.completeExceptionally(t);
                            emitter.emit("error", t);
                            Map<String, Object> payload = new HashMap<>();
                            payload.put("streamId", streamId);
                            payload.put("transport", "websocket");
                            emitter.emit("stream_disconnected", payload);
                        }
                    });
        } catch (IOException e) {
            welcome.completeExceptionally(e);
        }
        return welcome;
    }

    private CompletableFuture<String> connectStreamSse(
            String streamId, long fromCursor, Consumer<JsonNode> onEvent) {
        CompletableFuture<String> connected = new CompletableFuture<>();
        sseRunning = true;
        activeSseThread = new Thread(() -> {
            try {
                String token = getToken();
                String url = RealtimeUrls.buildStreamEventsUrl(
                        config.realtimeUrl, config, streamId, fromCursor, token, config.apiKey);
                Request req = new Request.Builder()
                        .url(url)
                        .header("Accept", "text/event-stream")
                        .header("Authorization", "Bearer " + token)
                        .get()
                        .build();
                try (Response resp = http.newCall(req).execute()) {
                    if (!resp.isSuccessful()) {
                        throw new CausetApiException(resp.code(), resp.body() != null ? resp.body().string() : resp.message());
                    }
                    connected.complete("sse-" + streamId);
                    Map<String, Object> payload = new HashMap<>();
                    payload.put("streamId", streamId);
                    payload.put("connId", "sse-" + streamId);
                    payload.put("transport", "sse");
                    emitter.emit("stream_connected", payload);

                    BufferedReader reader = new BufferedReader(new InputStreamReader(resp.body().byteStream()));
                    StringBuilder block = new StringBuilder();
                    String line;
                    while (sseRunning && (line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            emitSseBlock(block.toString(), onEvent);
                            block.setLength(0);
                            continue;
                        }
                        block.append(line).append('\n');
                    }
                }
            } catch (Exception e) {
                if (!connected.isDone()) {
                    connected.completeExceptionally(e);
                }
                emitter.emit("error", e);
            } finally {
                Map<String, Object> payload = new HashMap<>();
                payload.put("streamId", streamId);
                payload.put("transport", "sse");
                emitter.emit("stream_disconnected", payload);
            }
        }, "causet-sse-" + streamId);
        activeSseThread.setDaemon(true);
        activeSseThread.start();
        return connected;
    }

    private void emitSseBlock(String block, Consumer<JsonNode> onEvent) throws IOException {
        if (block.isBlank()) return;
        String data = null;
        for (String line : block.split("\n")) {
            if (line.startsWith("data:")) {
                data = line.substring(5).trim();
            }
        }
        if (data == null || data.isBlank()) return;
        onEvent.accept(MAPPER.readTree(data));
    }

    public static class StreamConnectOptions {
        public StreamTransport transport;
        public long fromCursor;
    }
}
