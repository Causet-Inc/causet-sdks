# @causet/sdk

Browser and native **ESM JavaScript** SDK for [Causet](https://causet.cloud). Re-exports `@causet/sdk-core`.

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/js`](.)) |
| **Package distribution** | Published to npm — `@causet/sdk` **0.2.0** |
| **Maturity** | Supported preview |
| **Support** | Supported for pilots — [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues) |

Platform documentation: [docs.causet.io](https://docs.causet.io)
| **Runtime compatibility** | ES2022+ with native `fetch`; Node.js 18+; TypeScript 5+ declarations; ESM only (no CommonJS bundle) |

Primary API: `client.submitIntent()`. Deprecated aliases: `intent()`, `emit()`.

## Features

Everything in [`@causet/sdk-core`](../core/README.md):

- Submit intents and stream SSE progress
- Run named projection queries
- Subscribe to entity state with local JSON patch application
- WebSocket real-time ledger streaming
- API key authentication with automatic JWT refresh

## Requirements

- ES2022+ environment with native `fetch`
- WebSocket support for real-time streaming (browser or polyfill)
- Node.js 18+ also works, but [`@causet/sdk-node`](../node/README.md) is preferred for server-side Node

## Installation

```bash
npm install @causet/sdk
```

From the monorepo:

```bash
cd causet-sdks
npm install
npm run build -w @causet/sdk
```

## Quick start

```javascript
import { CausetClient } from '@causet/sdk';

const client = new CausetClient({
  apiUrl: import.meta.env.VITE_CAUSET_API_URL,
  platformSlug: import.meta.env.VITE_CAUSET_PLATFORM,
  appSlug: import.meta.env.VITE_CAUSET_APPLICATION,
  bearerToken: sessionJwt, // browser: use Clerk/session JWT, not raw API keys
});

await client.init();

// Load entity state
await client.subscribe('ticket_stream', 'tkt_1');
console.log(client.getState('ticket_stream', 'tkt_1'));

// Submit intent (does not directly append a committed business event)
await client.submitIntent('ticket_stream', 'tkt_1', 'ADD_COMMENT', {
  body: 'Customer replied',
}, 'comment-tkt_1-001');

// Query projection table
const { items } = await client.runQuery('open_tickets', {}, { limit: 25 });

// Stream intent progress (SSE)
await client.intentStream('ticket_stream', 'tkt_1', 'CLOSE_TICKET', {}, (ev) => {
  if (ev.event === 'COMPLETE') console.log('Done', ev.data);
});

// Real-time updates — WebSocket (default) or SSE
await client.connectStream('ticket_stream'); // stream + fork
await client.connectStream('ticket_stream:tkt_1', { transport: 'sse', fromCursor: 100 });

client.on('stream_event', (ev) => {
  console.log(ev.event_type, ev.entity_id, ev.cursor);
});
client.on('state', ({ streamId, entityId, state }) => {
  console.log(streamId, entityId, state);
});
```

## WebSocket & SSE

Full protocol reference, example responses, and subscription modes are in [`@causet/sdk-core`](../core/README.md#real-time-streams--websocket--sse).

| Transport | Endpoint | Use when |
|-----------|----------|----------|
| WebSocket | `wss://*.realtime.causet.cloud/ws` | Duplex, lowest latency (default) |
| SSE | `GET .../streams/{streamId}/events?fork_id=` | One-way fanout, `EventSource`-friendly |

**WebSocket welcome response:**

```json
{"type":"welcome","v":1,"conn_id":"conn_7f3a9b2c","server_ts":1709068800000,"shard":42}
```

**Ledger event (both transports deliver this JSON shape):**

```json
{
  "cursor": 42,
  "stream_id": "ticket_stream",
  "entity_id": "tkt_1",
  "fork_id": "main",
  "event_type": "COMMENT_ADDED",
  "patch": [{"op": "add", "path": "/comments/-", "value": {"body": "Updated"}}]
}
```

**SSE wire format:**

```
id: 42
event: COMMENT_ADDED
data: {"cursor":42,"stream_id":"ticket_stream","entity_id":"tkt_1","event_type":"COMMENT_ADDED",...}

```

## Browser security note

**Do not embed API keys in client-side code.** API keys (`ck_live_...`) belong on the server. In the browser, authenticate users with your app session (Clerk, Auth0, etc.) and pass a short-lived Bearer token to the client, or proxy Causet calls through your backend.

For server-side API key usage, use [`@causet/sdk-node`](../node/README.md) or [`@causet/sdk-next/server`](../next/README.md).

## Configuration

Same options as [`CausetClient`](../core/README.md#configuration) from `@causet/sdk-core`:

```typescript
new CausetClient({
  apiUrl: string;
  platformSlug: string;
  appSlug: string;
  forkId?: string;
  bearerToken?: string;
  apiKey?: string;       // server-side only — avoid in browser bundles
  wsUrl?: string;
  fetchImpl?: typeof fetch;
});
```

## API

The full API is documented in [`@causet/sdk-core`](../core/README.md#api-reference). All exports:

```javascript
import {
  CausetClient,
  CausetError,
  CausetAuthError,
  CausetApiError,
  ApiKeyTokenManager,
  CausetTransportWebSocket,
  submitIntentStream,
  parseSseChunk,
  flattenProjectionItems,
  stringifyQueryInput,
} from '@causet/sdk';
```

## Bundler setup

### Vite

```typescript
// vite.config.ts — no special config needed
export default defineConfig({
  optimizeDeps: {
    include: ['@causet/sdk'],
  },
});
```

Environment variables (`.env`):

```env
VITE_CAUSET_API_URL=https://api.causet.cloud
VITE_CAUSET_PLATFORM=my-platform
VITE_CAUSET_APPLICATION=my-app
```

### TypeScript

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022"
  }
}
```

## Development

```bash
cd causet-sdks/packages/js

npm run build        # depends on @causet/sdk-core build
npm test             # re-export smoke tests + 100% coverage
npm run test:watch
```

Build order in the monorepo:

```bash
npm run build -w @causet/sdk-core && npm run build -w @causet/sdk
```

## Related packages

| Package | Use when |
|---------|----------|
| [`@causet/sdk-core`](../core) | Building a custom wrapper or need low-level HTTP helpers |
| [`@causet/sdk-node`](../node) | Node.js scripts, workers, Express/Fastify backends |
| [`@causet/sdk-next`](../next) | Next.js App Router with React hooks |
| [`causet-sdk`](../python) | Python async/sync |
| [`causet/laravel-sdk`](../laravel) | Laravel PHP |

## License

MIT
