# @causet/sdk-node

Node.js SDK for [Causet](https://causet.cloud). Wraps `@causet/sdk-core` with a convenience factory and binds Node's native `fetch`.

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/node`](.)) |
| **Package distribution** | Published to npm — `@causet/sdk-node` **0.2.0** |
| **Maturity** | Supported preview |
| **Support** | Supported for pilots |
| **Runtime compatibility** | Node.js 18+ (ESM); native `fetch`; Node 21+ recommended for WebSocket |

## Features

- Full [`@causet/sdk-core`](../core/README.md) API
- `createCausetClient()` helper with sensible Node defaults
- Native `fetch` (Node 18+) — no extra HTTP dependencies
- WebSocket streaming via global `WebSocket` (Node 21+) or inject via core options

## Requirements

- **Node.js 18+** (native `fetch`)
- Node 21+ recommended for native WebSocket; earlier versions may need a `WebSocket` polyfill for `connectStream()`

## Installation

```bash
npm install @causet/sdk-node
```

Monorepo:

```bash
cd causet-sdks
npm install
npm run build -w @causet/sdk-node
```

## Quick start

```javascript
import { createCausetClient } from '@causet/sdk-node';

const client = createCausetClient({
  apiUrl: process.env.CAUSET_API_URL ?? 'http://localhost:8085',
  platformSlug: process.env.CAUSET_PLATFORM,
  appSlug: process.env.CAUSET_APPLICATION,
  apiKey: process.env.CAUSET_API_KEY,
});

await client.init();

try {
  const result = await client.submitIntent('order_stream', 'ord_42', 'PLACE_ORDER', {
    items: [{ sku: 'ABC', qty: 2 }],
  }, 'place-order-ord_42');

  if (!result.accepted) {
    console.error(result.error);
    process.exit(1);
  }

  const query = await client.runQuery('recent_orders', { customer_id: 'cust_1' }, {
    limit: 10,
    includeTotal: true,
  });

  console.log(`${query.items.length} orders (total: ${query.total_count})`);
} finally {
  client.destroy();
}
```

## `createCausetClient`

```typescript
import { createCausetClient, CausetClient } from '@causet/sdk-node';

// Sets fetchImpl to globalThis.fetch when not provided
const client = createCausetClient(options);

// Equivalent manual setup:
const client2 = new CausetClient({
  ...options,
  fetchImpl: globalThis.fetch.bind(globalThis),
});
```

All [`CausetClient`](../core/README.md#configuration) options are supported.

## Environment variables

Typical `.env` for scripts and services:

```env
CAUSET_API_URL=https://api.causet.cloud
CAUSET_PLATFORM=my-platform
CAUSET_APPLICATION=my-app
CAUSET_FORK=main
CAUSET_API_KEY=ck_live_xxx.secret
```

## Common patterns

### Express route handler

```javascript
import { createCausetClient } from '@causet/sdk-node';

const causet = createCausetClient({ /* ... */ });
await causet.init();

app.post('/tickets', async (req, res) => {
  const result = await causet.intent(
    'ticket_stream',
    req.body.ticketId,
    'CREATE_TICKET',
    req.body.payload,
  );
  res.json(result);
});
```

### SSE intent with progress logging

```javascript
await causet.intentStream(
  'ticket_stream',
  'tkt_1',
  'PROCESS_REFUND',
  { amount_cents: 5000 },
  (ev) => console.log(`[${ev.event}]`, ev.data),
);
```

### Long-lived WebSocket worker

```javascript
await causet.subscribe('inventory_stream', 'sku_100');
await causet.connectStream('inventory_stream');

causet.on('stream_event', (ev) => {
  console.log(ev.event_type, ev.entity_id, ev.cursor);
});
causet.on('state', ({ entityId, state }) => {
  if (state.quantity < state.reorder_point) {
    // trigger reorder workflow
  }
});
```

### SSE stream (one-way)

```javascript
await causet.connectStream('inventory_stream:sku_100', {
  transport: 'sse',
  fromCursor: 0,
});

causet.on('stream_event', (ev) => {
  console.log(ev.event_type, ev.patch);
});
```

## WebSocket & SSE

Full protocol reference and example responses: [`@causet/sdk-core`](../core/README.md#real-time-streams--websocket--sse).

| Environment | WebSocket | Stream SSE base |
|-------------|-----------|-----------------|
| Sandbox | `wss://sandbox.realtime.causet.cloud/ws` | `https://sandbox.realtime.causet.cloud` |
| Prod | `wss://realtime.causet.cloud/ws` | `https://realtime.causet.cloud` |
| Local | `ws://localhost:8081/ws` | `http://localhost:8081` |

**WebSocket welcome:**

```json
{"type":"welcome","v":1,"conn_id":"conn_7f3a9b2c","server_ts":1709068800000,"shard":42}
```

**Ledger event:**

```json
{
  "cursor": 42,
  "stream_id": "inventory_stream",
  "entity_id": "sku_100",
  "event_type": "STOCK_ADJUSTED",
  "patch": [{"op": "replace", "path": "/quantity", "value": 95}]
}
```

**SSE wire block:**

```
id: 42
event: STOCK_ADJUSTED
data: {"cursor":42,"stream_id":"inventory_stream","entity_id":"sku_100","event_type":"STOCK_ADJUSTED",...}

```

## API

Re-exports everything from `@causet/sdk-core`. See the [core API reference](../core/README.md#api-reference).

```javascript
import {
  createCausetClient,
  CausetClient,
  CausetApiError,
  runQuery,
  submitIntentStream,
} from '@causet/sdk-node';
```

## Error handling

```javascript
import { CausetApiError } from '@causet/sdk-node';

try {
  await client.runQuery('missing_query', {});
} catch (err) {
  if (err instanceof CausetApiError && err.statusCode === 404) {
    console.log('Query not found');
  }
  throw err;
}
```

## Development

```bash
cd causet-sdks/packages/node

npm run build
npm test              # 100% coverage on package source
npm run test:watch
```

## Related packages

| Package | Use when |
|---------|----------|
| [`@causet/sdk`](../js) | Browser / Vite front-end |
| [`@causet/sdk-next`](../next) | Next.js with React hooks + server helpers |
| [`@causet/sdk-core`](../core) | Low-level TypeScript only |

## License

MIT
