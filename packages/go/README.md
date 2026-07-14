# Causet Go SDK

Go client for the Causet SaaS API — entity state caching, intents (sync and SSE progress), named queries, projections, entity listing, and live stream events via **WebSocket** or **SSE**. Method names mirror the other Causet SDKs (TypeScript, Python, Java, Laravel) using Go's exported `PascalCase` convention: `Emit`, `EmitStream`, `Subscribe`/`Unsubscribe`/`GetState`, `On`, `Select`, `RunQuery`, `ListQueries`, `ConnectStream`/`DisconnectStream`, etc.

## Install

```bash
go get github.com/causet-inc/causet-sdk-go
```

## Configuration

```go
client := causet.NewClient(causet.Config{
    APIURL:          "https://api.causet.cloud",
    PlatformSlug:    "my-platform",
    AppSlug:         "my-app",
    ForkID:          "sandbox",
    APIKey:          "ck_live_...",
    // Optional overrides (defaults derived from APIURL via terraform-aligned mapping):
    WSURL:           "wss://realtime.causet.cloud/ws",
    RealtimeURL:     "https://realtime.causet.cloud",
    StreamTransport: causet.StreamTransportSSE, // or StreamTransportWebSocket (default)
})
```

| Field | Description |
|-------|-------------|
| `ForkID` | Fork for intents, state, and stream subscriptions (default `main`) |
| `WSURL` | WebSocket endpoint (default `wss://*.realtime.causet.cloud/ws` from `APIURL`) |
| `RealtimeURL` | HTTP base for SSE stream events (default `https://*.realtime.causet.cloud`) |
| `StreamTransport` | Default live transport: `websocket` or `sse` |

## Lifecycle

```go
ctx := context.Background()
if err := client.Init(ctx); err != nil { // eagerly exchanges the API key for a JWT
    log.Fatal(err)
}
defer client.Destroy() // disconnects any active stream
```

## Entity state (subscribe / cache / select)

```go
if err := client.Subscribe("sku_stream", "sku-1"); err != nil {
    log.Fatal(err)
}
state, ok := client.GetState("sku_stream", "sku-1") // cached, deep-copied
_ = ok

unsubscribeQty := client.Select("sku_stream", "sku-1", func(s map[string]any) any {
    return s["quantity"]
}, func(qty any) {
    fmt.Println("quantity changed:", qty)
})
defer unsubscribeQty()

client.Unsubscribe("sku_stream", "sku-1")
```

`FetchState` is a one-shot, uncached read (no `Subscribe` required):

```go
state, cursor, err := client.FetchState("sku_stream", "sku-1")
```

## Events

```go
unsubscribe := client.On("state", func(data any) {
    fmt.Printf("%+v\n", data)
})
defer unsubscribe()
```

Event types: `state`, `patch_op`, `stream_event`, `stream_connected`, `stream_disconnected`, `emitted`, `error`.

## Intents

```go
// Synchronous — returns once accepted/rejected. Refreshes any Subscribe()d
// cache for the entity via statePatch (or a refetch) and emits "state".
result, err := client.Emit("sku_stream", "sku-1", "adjust_stock", map[string]any{"qty": -5})

// Streamed — SSE progress events (START, COMPLETE, ERROR, …). Blocks the
// calling goroutine until the stream closes; run in its own goroutine for
// non-blocking use.
err = client.EmitStream(ctx, "sku_stream", "sku-1", "adjust_stock", map[string]any{"qty": -5}, func(ev causet.SseEvent) {
    fmt.Println(ev.Event, ev.Data)
}, "")
```

## Queries & projections

```go
result, err := client.RunQuery("top_skus_by_velocity", map[string]any{"category": "electronics"}, causet.QueryOptions{
    Limit: 20,
})
queries, err := client.ListQueries()
def, err := client.GetQueryDefinition("top_skus_by_velocity")
projections, err := client.ListProjections()
entities, err := client.ListEntities(causet.ListEntitiesOptions{StreamName: "sku_stream", Limit: 50})
```

## WebSocket & SSE (live streams)

Live events come from **causet-realtime** (`*.realtime.causet.cloud`), not the SaaS API host. URLs are derived from `APIURL` automatically.

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

```go
ctx := context.Background()

// Stream + fork — all entities
connID, err := client.ConnectStream(ctx, "sku_stream", causet.StreamConnectOptions{
    FromCursor: 0,
}, func(ev map[string]any) {
    fmt.Println(ev["event_type"], ev["entity_id"], ev["cursor"])
})
fmt.Println("connected:", connID)

// Stream + fork + entity
connID, err = client.ConnectStream(ctx, "sku_stream:sku-1", causet.StreamConnectOptions{
    Transport:  causet.StreamTransportWebSocket,
    FromCursor: 100,
}, onEvent)
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
  "patch": [{"op": "replace", "path": "/quantity", "value": 95}],
  "emits": [{"event_type": "STOCK_ADJUSTED", "payload": {"delta": -5}}]
}
```

**Error response:**

```json
{"type":"error","code":"FORBIDDEN","message":"stream access denied"}
```

### SSE

```go
connID, err := client.ConnectStream(ctx, "sku_stream:sku-1", causet.StreamConnectOptions{
    Transport:  causet.StreamTransportSSE,
    FromCursor: 100,
}, func(ev map[string]any) {
    fmt.Println(ev["event_type"], ev["cursor"])
})
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

The SDK parses `data:` into `map[string]any` and passes it to your handler — same JSON shape as WebSocket events.

| Transport | Best for |
|-----------|----------|
| `websocket` | Duplex, `ledger` + `state` channel replay, lowest latency |
| `sse` | One-way fanout, simple consumers, HTTP-only environments |

## API summary

| Method | Purpose |
|---|---|
| `Init(ctx)` / `Destroy()` | Warm the API-key → JWT exchange / disconnect streams |
| `GetToken()` | Current bearer token (advanced use) |
| `On(eventType, handler)` | Subscribe to client events; returns an unsubscribe func |
| `Subscribe`/`Unsubscribe`/`GetState` | Cached entity state |
| `FetchState` | One-shot, uncached entity state read |
| `Select(streamId, entityId, selector, handler)` | Derived-state watcher over cached state |
| `Emit` | Submit an intent (sync) |
| `EmitStream` | Submit an intent and stream SSE progress |
| `RunQuery`/`ListQueries`/`GetQueryDefinition` | Named queries |
| `ListProjections` | Projection table definitions |
| `ListEntities` | Paginated entity ids |
| `ConnectStream`/`DisconnectStream` | Live ledger/projection events (WebSocket or SSE) |
