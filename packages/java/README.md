# Causet Java SDK

Java 17+ client for the Causet runtime API — entity state caching, submit-intent (sync and SSE progress), named queries, projections, entity listing, and live stream events via **WebSocket** or **SSE**.

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/java`](.)) |
| **Package distribution** | Source installation only — **Maven Central coming soon** |
| **Maturity** | Preview |
| **Support** | Community or best effort — [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues) |
| **Runtime compatibility** | Java 17+ |

Primary API: `client.submitIntent()`. Deprecated alias: `intent()`.

## Installation

Package distribution is currently **source installation only**. **Maven Central publishing is coming soon.**

```bash
git clone https://github.com/Causet-Inc/causet-sdks.git
cd causet-sdks/packages/java
mvn install
```

After Maven Central is available:

```xml
<dependency>
    <groupId>com.causet</groupId>
    <artifactId>causet-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Configuration

```java
CausetConfig cfg = new CausetConfig();
cfg.apiUrl = "https://api.causet.cloud";
cfg.platformSlug = "my-platform";
cfg.appSlug = "my-app";
cfg.forkId = "sandbox";
cfg.apiKey = "ck_live_...";
// Optional (defaults derived from apiUrl via terraform-aligned mapping):
cfg.wsUrl = "wss://realtime.causet.cloud/ws";
cfg.realtimeUrl = "https://realtime.causet.cloud";
cfg.streamTransport = StreamTransport.SSE; // or WEBSOCKET (default)

CausetClient client = new CausetClient(cfg);
```

| Field | Description |
|-------|-------------|
| `forkId` | Fork for state, intents, and streams (default `main`) |
| `wsUrl` | WebSocket endpoint (default `wss://*.realtime.causet.cloud/ws` from `apiUrl`) |
| `realtimeUrl` | HTTP base for SSE (default `https://*.realtime.causet.cloud`) |
| `streamTransport` | Default live transport: `WEBSOCKET` or `SSE` |

## Lifecycle

```java
client.init(); // eagerly exchanges the API key for a JWT (no-op with a static bearerToken)
// ...
client.close(); // AutoCloseable — disconnects any active stream (try-with-resources works too)
```

## Entity state (subscribe / cache / select)

```java
client.subscribe("sku_stream", "sku-1");
JsonNode state = client.getState("sku_stream", "sku-1"); // cached, deep-copied

Runnable unsubscribeQty = client.select("sku_stream", "sku-1",
        s -> s.get("quantity").asInt(),
        qty -> System.out.println("quantity changed: " + qty));

client.unsubscribe("sku_stream", "sku-1");
```

`fetchState` is a one-shot, uncached read (no `subscribe` required):

```java
EntityState result = client.fetchState("sku_stream", "sku-1");
JsonNode state = result.getState();
long cursor = result.getCursor();
```

## Events

```java
Runnable unsubscribe = client.on("state", data -> System.out.println(data));
```

Event types: `state`, `patch_op`, `stream_event`, `stream_connected`, `stream_disconnected`, `emitted`, `error`.

## Intents

```java
// Synchronous — returns once accepted/rejected. Refreshes any subscribe()d
// cache for the entity via statePatch (or a refetch) and emits "state".
JsonNode result = client.submitIntent("sku_stream", "sku-1", "adjust_stock", Map.of("qty", -5));

// Streamed — SSE progress events (START, COMPLETE, ERROR, …). Blocks the
// calling thread until the stream closes; run on its own thread/executor
// for non-blocking use.
client.intentStream("sku_stream", "sku-1", "adjust_stock", Map.of("qty", -5), ev -> {
    System.out.println(ev.event + " " + ev.data);
});
```

## Queries & projections

```java
CausetClient.QueryOptions opts = new CausetClient.QueryOptions();
opts.limit = 20;
JsonNode result = client.runQuery("top_skus_by_velocity", Map.of("category", "electronics"), opts);

JsonNode queries = client.listQueries();
JsonNode definition = client.getQueryDefinition("top_skus_by_velocity");
JsonNode projections = client.listProjections();

CausetClient.ListEntitiesOptions listOpts = new CausetClient.ListEntitiesOptions();
listOpts.streamName = "sku_stream";
listOpts.limit = 50;
JsonNode entities = client.listEntities(listOpts);
```

## WebSocket & SSE (live streams)

Live events come from the **realtime service** (`*.realtime.causet.cloud`), not the Causet Cloud gateway host.

| Environment | Realtime HTTP | WebSocket |
|-------------|---------------|-----------|
| Sandbox | `https://sandbox.realtime.causet.cloud` | `wss://sandbox.realtime.causet.cloud/ws` |
| Prod | `https://realtime.causet.cloud` | `wss://realtime.causet.cloud/ws` |
| Local | `http://localhost:8081` | `ws://localhost:8081/ws` |

### Subscription modes

| Mode | `stream_id` | `fork_id` |
|------|-------------|-----------|
| Stream + fork | `sku_stream` | `sandbox` |
| Stream + fork + entity | `sku_stream:sku-1` | `sandbox` |

### WebSocket

```java
// Stream + fork — all entities
client.connectStream("sku_stream", null, event -> {
    System.out.println(event.get("event_type") + " " + event.get("entity_id"));
}).join();

// Stream + fork + entity, resume from cursor
CausetClient.StreamConnectOptions opts = new CausetClient.StreamConnectOptions();
opts.transport = StreamTransport.WEBSOCKET;
opts.fromCursor = 100;
client.connectStream("sku_stream:sku-1", opts, event -> {
    System.out.println(event.get("cursor"));
}).join();

client.disconnectStream();
```

**Hello (sent automatically):**

```json
{"type":"hello","v":1,"stream_id":"sku_stream","fork_id":"sandbox","subs":[{"channel":"ledger"},{"channel":"state"}]}
```

**Welcome response:**

```json
{"type":"welcome","v":1,"conn_id":"conn_7f3a9b2c","server_ts":1709068800000,"shard":42}
```

**Ledger event (delivered to your handler):**

```json
{
  "cursor": 42,
  "stream_id": "sku_stream",
  "entity_id": "sku-1",
  "fork_id": "sandbox",
  "event_type": "STOCK_ADJUSTED",
  "patch": [{"op": "replace", "path": "/quantity", "value": 95}]
}
```

**Error response:**

```json
{"type":"error","code":"FORBIDDEN","message":"stream access denied"}
```

### SSE

```java
CausetClient.StreamConnectOptions opts = new CausetClient.StreamConnectOptions();
opts.transport = StreamTransport.SSE;
opts.fromCursor = 100;

client.connectStream("sku_stream:sku-1", opts, event -> {
    System.out.println(event.get("event_type"));
}).join();
```

**HTTP request (built automatically):**

```
GET https://sandbox.realtime.causet.cloud/v1/platforms/my-platform/applications/my-app/streams/sku_stream:sku-1/events?fork_id=sandbox&from_cursor=100&token=eyJ...
Accept: text/event-stream
Authorization: Bearer eyJ...
```

**Wire response:**

```
id: 42
event: STOCK_ADJUSTED
data: {"cursor":42,"stream_id":"sku_stream","entity_id":"sku-1","fork_id":"sandbox","event_type":"STOCK_ADJUSTED","patch":[{"op":"replace","path":"/quantity","value":95}]}

```

The SDK parses each `data:` line into a `Map<String, Object>` — same JSON shape as WebSocket events.

| Transport | Best for |
|-----------|----------|
| `WEBSOCKET` | Duplex, channel replay, lowest latency |
| `SSE` | One-way fanout, HTTP-only environments |

## API summary

| Method | Purpose |
|---|---|
| `init()` / `close()` | Warm the API-key → JWT exchange / disconnect streams (`AutoCloseable`) |
| `getToken()` | Current bearer token (advanced use) |
| `on(eventType, handler)` | Subscribe to client events; returns an unsubscribe `Runnable` |
| `subscribe`/`unsubscribe`/`getState` | Cached entity state |
| `fetchState` | One-shot, uncached entity state + cursor (`EntityState`) |
| `select(streamId, entityId, selector, handler)` | Derived-state watcher over cached state |
| `submitIntent` | Submit an intent (sync) |
| `intent` | Deprecated — use `submitIntent` |
| `intentStream` | Submit an intent and stream SSE progress |
| `runQuery`/`listQueries`/`getQueryDefinition` | Named queries |
| `listProjections` | Projection table definitions |
| `listEntities` | Paginated entity ids |
| `connectStream`/`disconnectStream` | Live ledger/projection events (WebSocket or SSE) |
