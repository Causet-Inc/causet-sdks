# causet-sdk

Official **Python** SDK for the [Causet](https://causet.cloud) event-sourcing platform. Submit intents, run named queries, stream SSE progress, and receive real-time WebSocket patches.

Provides both **async** (`CausetClient`) and **sync** (`CausetClientSync`) APIs.

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/python`](.)) |
| **Package distribution** | Source installation only — **not on PyPI yet** |
| **Maturity** | Preview |
| **Support** | Community or best effort — [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues) |

Platform documentation: [docs.causet.io](https://docs.causet.io)
| **Runtime compatibility** | Python 3.10+ |

Primary API: `await client.submit_intent()`. Deprecated alias: `intent()`.

## Features

- Intent submission via runtime API (`POST .../intents/submit`)
- SSE intent streaming with progress events
- Named projection queries with pagination and cursor support
- Entity state subscribe/cache with JSON Patch application
- WebSocket real-time streaming (ledger + state channels)
- API key → JWT exchange with automatic refresh
- State selectors for derived observables
- Projection row key flattening (`table.column` → `column`)

## Requirements

- Python 3.10+
- Dependencies: `httpx`, `websockets`

## Installation

Package distribution is currently **source installation only**. The package is **not on PyPI yet**.

```bash
git clone https://github.com/Causet-Inc/causet-sdks.git
cd causet-sdks/packages/python
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

When PyPI publishing is announced, installation will be `pip install causet-sdk`.

## Quick start (async)

```python
import asyncio
from causet_sdk import CausetClient

async def main():
    client = CausetClient(
        api_url="https://api.causet.cloud",
        platform_slug="my-platform",
        app_slug="my-app",
        api_key="ck_live_xxx.secret",
    )
    await client.init()

    # Subscribe and read entity state
    await client.subscribe("ticket_stream", "tkt_1")
    print(client.get_state("ticket_stream", "tkt_1"))

    # Submit intent
    result = await client.submit_intent(
        "ticket_stream",
        "tkt_1",
        "CREATE_TICKET",
        {"customer_id": "cust_1", "subject": "Help", "body": "..."},
        intent_id="create-ticket-tkt_1-001",
    )
    print("Accepted:", result["accepted"], "Execution:", result.get("execution_id"))

    # Run query
    rows = await client.run_query("urgent_tickets", {"status": "open"}, limit=20)
    print(f"{len(rows['items'])} tickets")

    # SSE intent progress
    await client.intent_stream(
        "ticket_stream", "tkt_1", "PROCESS_REFUND", {"amount_cents": 5000},
        on_event=lambda ev: print(ev.get("event"), ev.get("data")),
    )

    # Live stream — WebSocket (default) or SSE
    await client.connect_stream("ticket_stream")  # stream + fork
    await client.connect_stream("ticket_stream:tkt_1", transport="sse", from_cursor=100)

    client.destroy()

asyncio.run(main())
```

## Quick start (sync)

For scripts, CLI tools, or synchronous frameworks:

```python
from causet_sdk import CausetClientSync

client = CausetClientSync(
    api_url="https://api.causet.cloud",
    platform_slug="my-platform",
    app_slug="my-app",
    bearer_token="eyJ...",
)
client.init()
client.subscribe("orders", "ord_1")
print(client.get_state("orders", "ord_1"))
client.destroy()
```

`CausetClientSync` wraps every async method with `asyncio.run()`.

## Configuration

```python
CausetClient(
    api_url: str,              # required — e.g. "https://api.causet.cloud"
    platform_slug: str,        # required
    app_slug: str,             # required
    fork_id: str = "main",      # fork for intents, state, streams
    ws_url: str | None = None, # WebSocket URL (derived: wss://*.realtime.causet.cloud/ws)
    realtime_url: str | None = None,  # SSE HTTP base (derived: https://*.realtime.causet.cloud)
    stream_transport: str = "websocket",  # or "sse"
    bearer_token: str = "",     # static JWT
    api_key: str = "",         # cloud API key (preferred for servers)
)
```

Provide **either** `api_key` or `bearer_token`.

## Authentication

API keys (`ck_live_...`) are exchanged via `POST /v1/token` with header `Authorization: ApiKey ck_live_...`. The SDK:

- Caches the JWT until ~30 seconds before expiry (default TTL 300s)
- Coalesces concurrent token requests
- Retries transient network errors (up to 4 attempts)
- Force-refreshes on HTTP 401 and retries the original request once

```python
token = await client.get_token()
ids = await client.get_realtime_ids()  # project_id + env for WebSocket
```

## API reference

### Lifecycle

```python
await client.init()     # eager token exchange (optional)
client.destroy()        # disconnect WebSocket, cancel refresh task
client.update_config(bearer_token="new-jwt")
```

### Entity state

```python
await client.subscribe("stream", "entity")
client.get_state("stream", "entity")           # deep clone or None
client.unsubscribe("stream", "entity")

await client.fetch_state("stream", "entity")     # one-shot, no cache
await client.fetch_state_at_cursor("s", "e", 42)
await client.diff_state("s", "e", cursor_a=10, cursor_b=20)
await client.list_entities(stream_name="orders", limit=50)
```

### Intents

```python
result = await client.submit_intent(
    "stream", "entity", "INTENT_TYPE",
    {"key": "value"},
    intent_id="optional-idempotency-key",
)
# {"accepted": bool, "execution_id": str|None, "error": str|None, "state_patch": ...}

await client.intent_stream(
    "stream", "entity", "INTENT_TYPE", payload,
    on_event=lambda ev: print(ev),
    intent_id=None,
)
```

### Queries and projections

```python
await client.run_query(
    "query_slug",
    {"param": "value"},
    limit=30,           # page size (HTTP layer — not DSL input.limit)
    offset=0,           # skipped when cursor is set
    cursor="abc",
    include_total=True,
)

await client.list_queries()
await client.get_query_definition("query_slug")
await client.list_projections()
await client.get_projection_schema("projection_slug")
```

**Query input stringification:** Python values are coerced to strings before send — booleans → `"true"`/`"false"`, lists/dicts → JSON, numbers → decimal strings.

**Row flattening:** Dotted keys like `artist_directory.artist_id` become `artist_id` in result rows. See `causet_sdk.flatten_projection_row`.

### Real-time streams — WebSocket & SSE

Live ledger and projection events come from the **realtime service** (`*.realtime.causet.cloud`), not the Causet Cloud gateway host.

| Environment | Realtime HTTP | WebSocket |
|-------------|---------------|-----------|
| Sandbox | `https://sandbox.realtime.causet.cloud` | `wss://sandbox.realtime.causet.cloud/ws` |
| Prod | `https://realtime.causet.cloud` | `wss://realtime.causet.cloud/ws` |
| Local | `http://localhost:8081` | `ws://localhost:8081/ws` |

#### Subscription modes

| Mode | `stream_id` | `fork_id` |
|------|-------------|-----------|
| Stream + fork | `sku_stream` | `sandbox` |
| Stream + fork + entity | `sku_stream:sku-1` | `sandbox` |

#### WebSocket

```python
await client.init()

# Stream + fork — all entities (default transport)
conn_id = await client.connect_stream(
    "sku_stream",
    from_cursor=0,
    channels=[{"channel": "ledger"}, {"channel": "state"}],
)

def on_event(ev: dict) -> None:
    print(ev.get("event_type"), ev.get("entity_id"), ev.get("cursor"))

client.on("stream_event", on_event)
client.on("stream_connected", lambda ev: print(ev["conn_id"], ev["transport"]))

# Stream + fork + entity, resume from cursor
await client.connect_stream(
    "sku_stream:sku-1",
    transport="websocket",
    from_cursor=100,
)

client.disconnect_stream()
```

**Hello (sent automatically):**

```json
{"type":"hello","v":1,"stream_id":"sku_stream","fork_id":"sandbox","subs":[{"channel":"ledger"},{"channel":"state"}]}
```

**Welcome response:**

```json
{"type":"welcome","v":1,"conn_id":"conn_7f3a9b2c","server_ts":1709068800000,"shard":42}
```

**Ledger event (delivered to `stream_event` handler):**

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

#### SSE

```python
client = CausetClient(
    api_url="https://sandbox.api.causet.cloud",
    platform_slug="my-platform",
    app_slug="my-app",
    fork_id="sandbox",
    stream_transport="sse",
    api_key="ck_live_...",
)
await client.init()

await client.connect_stream("sku_stream:sku-1", transport="sse", from_cursor=100)

client.on("stream_event", lambda ev: print(ev["event_type"], ev["cursor"]))
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

The SDK parses `data:` into a `dict` and emits it on `stream_event` — same JSON shape as WebSocket events.

| Transport | Best for |
|-----------|----------|
| `websocket` | Duplex, channel replay, lowest latency |
| `sse` | One-way fanout, HTTP-only environments |

> **Note:** `intent_stream()` uses a separate SSE channel for **intent progress** (`START`, `COMPLETE`, `ERROR`) during intent execution — that is not the same as stream SSE above.

### Selectors

```python
unsub = client.select(
    "stream", "entity",
    lambda state: state["cart"]["total"],
    lambda total: print(f"Total: {total}"),
)
unsub()
```

### Events

```python
off = client.on("state", handler)
off()  # unsubscribe

client.on("*", lambda event_type, data: ...)  # wildcard
```

## Error handling

```python
from causet_sdk import CausetError, CausetAuthError, CausetApiError

try:
    await client.intent(...)
except CausetApiError as e:
    print(e.status_code, e.body)
except CausetAuthError as e:
    print("Auth failed:", e)
```

## HTTP endpoints

| Operation | Path |
|-----------|------|
| Token | `POST /v1/token` |
| Intent | `POST /v1/runtime/platforms/{p}/applications/{a}/intents/submit` |
| Intent SSE | `POST /v1/runtime/stream/platforms/{p}/applications/{a}/intents/submit` |
| Entity state | `GET /v1/platforms/{p}/applications/{a}/entities/{stream}/{id}/state` |
| Query | `POST /v1/platforms/{p}/applications/{a}/forks/{fork}/queries/{slug}/run` |
| Stream WebSocket | `WS wss://*.realtime.causet.cloud/ws` |
| Stream SSE | `GET {realtimeUrl}/v1/platforms/{p}/applications/{a}/streams/{streamId}/events` |

## Development

```bash
cd causet-sdks/packages/python
source .venv/bin/activate
pip install -e ".[dev]"

# Run tests (100% coverage enforced)
pytest --cov=causet_sdk --cov-report=term-missing --cov-fail-under=100

# Lint
ruff check causet_sdk tests
```

### Project structure

```
causet_sdk/
  client.py           # CausetClient (async)
  _sync.py            # CausetClientSync
  http_client.py      # REST layer
  token_manager.py    # API key auth
  transport_sse.py    # SSE streaming
  transport_ws.py     # WebSocket transport
  patch.py            # JSON Patch
  query_projection.py # Row flattening
  emitter.py          # Event bus
  errors.py           # Exceptions
tests/                # pytest suite
```

## Related packages

| Package | Language |
|---------|----------|
| [`@causet/sdk-core`](../core) | TypeScript core |
| [`@causet/sdk-next`](../next) | Next.js + React |
| [`causet/laravel-sdk`](../laravel) | Laravel PHP |

## License

MIT
