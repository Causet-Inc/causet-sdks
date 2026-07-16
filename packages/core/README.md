# @causet/sdk-core

Core TypeScript client for the [Causet](https://causet.cloud) runtime API. Implements submit-intent, named queries, SSE intent streaming, WebSocket ledger patches, entity state caching, and API-key JWT exchange.

This is the shared implementation used by `@causet/sdk`, `@causet/sdk-node`, and `@causet/sdk-next`. Most applications should install one of those packages instead of core directly.

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/core`](.)) |
| **Package distribution** | Published to npm — `@causet/sdk-core` **0.2.0** |
| **Maturity** | Supported preview |
| **Support** | Supported for pilots |
| **Runtime compatibility** | Node.js 18+; browsers with `fetch`; TypeScript 5+; ESM only |

## Features

- **Intent submission** — `POST /v1/runtime/.../intents/submit`
- **SSE intent progress** — stream `START`, `COMPLETE`, `ERROR` events during intent execution
- **Named queries** — run projection queries with pagination, cursor, and total count
- **Entity state** — subscribe, cache, and apply JSON patches locally
- **WebSocket streaming** — real-time ledger and state patches via the causet-realtime protocol
- **API key auth** — automatic JWT exchange and refresh (~5 min TTL)
- **Selectors** — observe derived slices of entity state
- **Zero runtime dependencies** — uses native `fetch` and `WebSocket` (injectable)

## Requirements

- Node.js 18+ or any environment with `fetch` (browser, Deno, Bun)
- TypeScript 5+ recommended for types

## Installation

```bash
npm install @causet/sdk-core
```

In the Causet monorepo:

```bash
cd causet-sdks
npm install
npm run build -w @causet/sdk-core
```

## Quick start

```typescript
import { CausetClient } from '@causet/sdk-core';

const client = new CausetClient({
  apiUrl: 'https://api.causet.cloud',   // or http://localhost:8085
  platformSlug: 'my-platform',
  appSlug: 'my-app',
  forkId: 'main',                        // optional, default "main"
  apiKey: 'ck_live_xxx.secret',          // or bearerToken: 'eyJ...'
});

await client.init();

// Submit an intent
const result = await client.submitIntent('ticket_stream', 'tkt_1', 'CREATE_TICKET', {
  customer_id: 'cust_1',
  subject: 'Help',
  body: 'Need assistance',
});
console.log(result.accepted, result.executionId);

// Run a named query
const rows = await client.runQuery('urgent_tickets', { status: 'open' }, { limit: 20 });
console.log(rows.items, rows.next_cursor);

client.destroy();
```

## Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiUrl` | `string` | yes | Causet Cloud gateway base URL (e.g. `https://api.causet.cloud`) |
| `platformSlug` | `string` | yes | Platform slug |
| `appSlug` | `string` | yes | Application slug |
| `forkId` | `string` | no | Fork id for intents, state, and streams (default `main`) |
| `apiKey` | `string` | no | Cloud API key (`ck_live_...`) — exchanged for JWT |
| `bearerToken` | `string` | no | Static Bearer JWT (Clerk session or pre-fetched token) |
| `wsUrl` | `string` | no | WebSocket URL for causet-realtime (default derived from `apiUrl`) |
| `realtimeUrl` | `string` | no | HTTP base for SSE stream events (default derived from `apiUrl` → `*.realtime.causet.cloud`) |
| `streamTransport` | `'websocket' \| 'sse'` | no | Default live stream transport (default `websocket`) |
| `fetchImpl` | `typeof fetch` | no | Custom fetch (testing, Node polyfill) |

Provide **either** `apiKey` or `bearerToken`. API keys are preferred for server-side integrations.

## Authentication

API keys are exchanged once via `POST /v1/token` with header `Authorization: ApiKey ck_live_...`. The SDK caches the JWT and refreshes it ~30 seconds before expiry. On HTTP 401, the client force-refreshes and retries once.

```typescript
const token = await client.getTokenPublic(); // throws if no credentials
```

## API reference

### Lifecycle

```typescript
await client.init();    // eager token exchange (optional)
client.destroy();       // disconnect WebSocket, cancel token refresh
```

### Entity state

```typescript
await client.subscribe('stream_id', 'entity_id');  // fetch + cache + emit "state"
client.getState('stream_id', 'entity_id');           // deep clone or null
client.unsubscribe('stream_id', 'entity_id');

await client.fetchState('stream_id', 'entity_id');   // one-shot, no cache
await client.listEntities({ streamName: 'orders', limit: 50 });
```

After a successful intent, the client applies `statePatch` from the response or refetches entity state if no patch was returned.

### Submit an intent

```typescript
// Primary API — submits an intent to the runtime (not a committed event)
const result = await client.submitIntent(
  'stream_id',
  'entity_id',
  'INTENT_TYPE',
  { key: 'value' },
  'optional-idempotency-key', // intentId
);

// Deprecated aliases: client.intent(), client.emit()

// SSE streaming progress
await client.intentStream(
  'stream_id',
  'entity_id',
  'INTENT_TYPE',
  payload,
  (ev) => console.log(ev.event, ev.data),
  'optional-idempotency-key',
  abortSignal,
);
```

### Queries

```typescript
await client.runQuery('query_slug', { param: 'value' }, {
  limit: 30,
  offset: 0,           // omitted when cursor is set
  cursor: 'abc123',    // keyset pagination
  includeTotal: true,
});

await client.listQueries();
await client.getQueryDefinition('query_slug');
await client.listProjections();
```

Query `input` values are stringified automatically (booleans → `"true"`/`"false"`, objects/arrays → JSON). Projection row keys like `table.column` are flattened to `column`.

### Real-time streams — WebSocket & SSE

Live ledger / state patches from **causet-realtime**. Prefer **SSE** for browser demos (multi-stream friendly); **WebSocket** for duplex lowest latency.

```typescript
await client.resolveIds(); // slug → UUID (required for SSE hub matching on local)

// One stream (replaces any prior connection for that streamId only)
await client.connectStream('wallet_stream', {
  transport: 'sse',       // or 'websocket' (default)
  fromCursor: -1,         // live-only; omit for full replay; >0 to resume
});

// Several streams at once (e.g. wallet + transfer)
await client.connectStreams(['wallet_stream', 'transfer_stream'], {
  transport: 'sse',
  fromCursor: -1,
});

client.on('stream_event', ({ streamId, event }) => { /* raw envelope */ });
client.on('domain_event', ({ streamId, type, entity, payload }) => { /* business emits */ });
client.on('stream_connected', ({ streamId, transport }) => {});
client.disconnectStream();              // all
client.disconnectStream('wallet_stream'); // one
```

Live ledger and projection events come from the **realtime service** (not the Causet Cloud gateway host). URLs are derived automatically from `apiUrl`:

| Environment | API URL | Realtime / WebSocket |
|-------------|---------|----------------------|
| Sandbox | `https://sandbox.api.causet.cloud` | `https://sandbox.realtime.causet.cloud` → `wss://sandbox.realtime.causet.cloud/ws` |
| Prod | `https://api.causet.cloud` | `https://realtime.causet.cloud` → `wss://realtime.causet.cloud/ws` |
| Local | `http://localhost:8085` | `http://localhost:8081` → `ws://localhost:8081/ws` |

#### Subscription modes

| Mode | `stream_id` | `fork_id` | Receives |
|------|-------------|-----------|----------|
| Stream + fork | `sku_stream` | `sandbox` | All entities on that stream/fork |
| Stream + fork + entity | `sku_stream:sku-1` | `sandbox` | Only `sku-1` on that fork |

---

#### WebSocket

**Endpoint:** `{wsUrl}` (default derived from `realtimeUrl` + `/ws`)

**Usage — stream + fork (all entities):**

```typescript
await client.init();

const connId = await client.connectStream('sku_stream', {
  fromCursor: 0,
  channels: [{ channel: 'ledger' }, { channel: 'state' }],
});

client.on('stream_event', (ev) => {
  console.log(ev.event_type, ev.entity_id, ev.cursor);
});

client.on('stream_connected', ({ connId, transport }) => {
  console.log(`Connected via ${transport}: ${connId}`);
});
```

**Usage — stream + fork + entity:**

```typescript
await client.connectStream('sku_stream:sku-1', {
  transport: 'websocket',
  fromCursor: 100, // resume from cursor 100
});
```

**Client → server (sent automatically on connect):**

```json
{
  "type": "hello",
  "v": 1,
  "stream_id": "sku_stream",
  "fork_id": "sandbox",
  "subs": [
    { "channel": "ledger", "from_cursor": 0 },
    { "channel": "state", "from_cursor": 0 }
  ]
}
```

**Server → client — welcome:**

```json
{
  "type": "welcome",
  "v": 1,
  "conn_id": "conn_7f3a9b2c",
  "server_ts": 1709068800000,
  "shard": 42
}
```

**Server → client — ledger patch event:**

```json
{
  "cursor": 42,
  "platform_id": "org_abc",
  "application_id": "app_xyz",
  "stream_id": "sku_stream",
  "entity_id": "sku-1",
  "fork_id": "sandbox",
  "intent_id": "intent_abc",
  "event_type": "STOCK_ADJUSTED",
  "patch": [
    { "op": "replace", "path": "/quantity", "value": 95 }
  ],
  "emits": [
    { "event_type": "STOCK_ADJUSTED", "payload": { "delta": -5 } }
  ],
  "metadata": {
    "causation_id": "intent_abc",
    "correlation_id": "uuid-...",
    "ts": "2025-02-27T12:00:00Z"
  }
}
```

**Server → client — projection write:**

```json
{
  "cursor": 43,
  "stream_id": "sku_stream",
  "entity_id": "sku-1",
  "fork_id": "sandbox",
  "projection_name": "inventory",
  "event_type": "projection:inventory",
  "trigger_event_type": "STOCK_ADJUSTED",
  "row": {
    "sku": "sku-1",
    "quantity": 95,
    "updated_at": "2025-02-27T12:00:00Z"
  }
}
```

**Server → client — error:**

```json
{
  "type": "error",
  "code": "FORBIDDEN",
  "message": "stream access denied"
}
```

---

#### SSE (Server-Sent Events)

**Endpoint:**

```
GET {realtimeUrl}/v1/platforms/{platform}/applications/{app}/streams/{streamId}/events
    ?fork_id={fork}&from_cursor={cursor}&token={jwt}
```

**Usage — stream + fork + entity via SSE:**

```typescript
const client = new CausetClient({
  apiUrl: 'https://sandbox.api.causet.cloud',
  platformSlug: 'my-platform',
  appSlug: 'my-app',
  forkId: 'sandbox',
  streamTransport: 'sse', // default transport
  apiKey: process.env.CAUSET_API_KEY,
});

await client.init();

await client.connectStream('sku_stream:sku-1', {
  transport: 'sse',
  fromCursor: 100,
});

client.on('stream_event', (ev) => {
  console.log(ev.event_type, ev.cursor);
});
```

**Wire format (what causet-realtime sends):**

```
id: 42
event: STOCK_ADJUSTED
data: {"cursor":42,"stream_id":"sku_stream","entity_id":"sku-1","fork_id":"sandbox","event_type":"STOCK_ADJUSTED","patch":[{"op":"replace","path":"/quantity","value":95}]}

```

The SDK parses each `data:` line and delivers the JSON object to your `stream_event` handler (same shape as WebSocket ledger events).

**Heartbeat:** the server sends `: ping` comments every ~15s to keep the connection alive.

---

#### When to use which transport

| Transport | Best for |
|-----------|----------|
| `websocket` | Duplex subscriptions, channel replay (`ledger` + `state`), lowest latency |
| `sse` | One-way fanout, mobile/browser `EventSource`, simple consumers |

```typescript
client.disconnectStream();
```

Helpers: `buildStreamEventsUrl`, `deriveRealtimeUrl`, `deriveWsUrl`, `CausetTransportStreamSse`, `CausetTransportWebSocket`.

### Selectors

```typescript
const unsub = client.select(
  'stream_id',
  'entity_id',
  (state) => state.cart?.total,
  (total) => console.log('Cart total:', total),
);
unsub();
```

### Events

```typescript
const off = client.on('state', handler);
off(); // unsubscribe

client.on('*', (eventType, data) => { /* wildcard */ });
```

## Low-level exports

For advanced use or custom integrations:

```typescript
import {
  ApiKeyTokenManager,
  deriveWsUrl,
  orgIdFromToken,
  submitIntent,
  fetchState,
  runQuery,
  submitIntentStream,
  parseSseChunk,
  CausetTransportWebSocket,
  flattenProjectionItems,
  stringifyQueryInput,
  CausetError,
  CausetAuthError,
  CausetApiError,
} from '@causet/sdk-core';
```

## Error handling

```typescript
import { CausetApiError, CausetAuthError, CausetError } from '@causet/sdk-core';

try {
  await client.submitIntent(...);
} catch (e) {
  if (e instanceof CausetApiError) {
    console.error(e.statusCode, e.body);
  } else if (e instanceof CausetAuthError) {
    console.error('Auth failed:', e.message);
  }
}
```

## HTTP endpoints used

| Operation | Method | Path |
|-----------|--------|------|
| Token exchange | `POST` | `/v1/token` |
| Submit intent | `POST` | `/v1/runtime/platforms/{p}/applications/{a}/intents/submit` |
| Intent SSE | `POST` | `/v1/runtime/stream/platforms/{p}/applications/{a}/intents/submit` |
| Entity state | `GET` | `/v1/platforms/{p}/applications/{a}/entities/{stream}/{id}/state` |
| Run query | `POST` | `/v1/platforms/{p}/applications/{a}/forks/{fork}/queries/{slug}/run` |
| WebSocket | `WS` | `wss://*.realtime.causet.cloud/ws` (derived from `apiUrl`) |
| Stream SSE | `GET` | `{realtimeUrl}/v1/platforms/{p}/applications/{a}/streams/{streamId}/events` |

## Idempotency

Pass an `intentId` as the last argument to `submitIntent()` (or `intentStream()`). The runtime uses this as an idempotency key for duplicate submissions.

## Timeouts and retries

- API key exchange retries transient network errors (up to 4 attempts in the token manager).
- On HTTP 401, the client force-refreshes the JWT and retries the request once.
- `fetch` and WebSocket timeouts follow the host environment defaults; inject `fetchImpl` for custom timeout behavior.

## Known limitations

- ESM only — no CommonJS bundle.
- Browser bundles must not embed API keys; use `bearerToken` or proxy through your backend.
- `0.x` preview — breaking API changes may ship in minor releases.

## Support policy

**Supported for pilots** — report issues via [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues). Platform docs: [docs.causet.io](https://docs.causet.io). See [SUPPORT.md](../../SUPPORT.md).

## Development

```bash
cd causet-sdks/packages/core

npm install          # from monorepo root
npm run build        # tsc → dist/
npm test             # vitest with 100% coverage gate
npm run test:watch   # watch mode
```

### Project structure

```
src/
  client.ts           # CausetClient
  http-client.ts      # REST helpers
  token-manager.ts    # API key → JWT
  transport-sse.ts    # SSE parsing + streaming
  transport-ws.ts     # WebSocket transport
  patch.ts            # JSON Patch apply
  query-projection.ts # Row flattening + input stringify
  emitter.ts          # Event bus
  errors.ts           # Exception types
  types.ts            # TypeScript interfaces
```

## License

MIT
