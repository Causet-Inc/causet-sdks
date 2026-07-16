# @causet/sdk-next

Next.js integration for [Causet](https://causet.cloud) — React hooks for client components and server helpers for Route Handlers, Server Actions, and API routes.

Built on [`@causet/sdk-core`](../core/README.md).

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/next`](.)) |
| **Package distribution** | Published to npm — `@causet/sdk-next` **0.1.0** |
| **Maturity** | Supported preview |
| **Support** | Supported for pilots |
| **Runtime compatibility** | Next.js 14+; React 18+; Node.js 18+ |

Primary hooks: `useCausetSubmitIntent()`, `serverSubmitIntent()`. Deprecated: `useCausetIntent()`, `serverIntent()`.

## Features

- **`CausetProvider`** — React context with automatic `init()` / `destroy()` lifecycle
- **Hooks** — `useCausetQuery`, `useCausetIntent`, `useCausetEntity`, `useCausetClient`
- **Server helpers** — `createServerCausetClient`, `serverRunQuery`, `serverIntent`
- **Env-based config** — reads `CAUSET_*` and `NEXT_PUBLIC_CAUSET_*` variables
- App Router and Pages Router compatible (client hooks require `'use client'`)

## Requirements

- Next.js 14+
- React 18+
- Node.js 18+

## Installation

```bash
npm install @causet/sdk-next
```

Monorepo:

```bash
cd causet-sdks
npm install
npm run build -w @causet/sdk-next
```

## Environment variables

```env
# Server-only (Route Handlers, Server Actions)
CAUSET_API_URL=https://api.causet.cloud
CAUSET_PLATFORM=my-platform
CAUSET_APPLICATION=my-app
CAUSET_FORK=main
CAUSET_API_KEY=ck_live_xxx.secret
CAUSET_BEARER_TOKEN=           # alternative to API key

# Client-safe (browser provider — no secrets)
NEXT_PUBLIC_CAUSET_API_URL=https://api.causet.cloud
NEXT_PUBLIC_CAUSET_PLATFORM=my-platform
NEXT_PUBLIC_CAUSET_APPLICATION=my-app
```

**Never expose `CAUSET_API_KEY` to the browser.** Use server helpers for API-key auth; pass a user JWT to `CausetProvider` for client-side calls.

## Quick start

### 1. Provider (client component)

```tsx
// app/providers.tsx
'use client';

import { CausetProvider } from '@causet/sdk-next';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CausetProvider
      options={{
        apiUrl: process.env.NEXT_PUBLIC_CAUSET_API_URL!,
        platformSlug: process.env.NEXT_PUBLIC_CAUSET_PLATFORM!,
        appSlug: process.env.NEXT_PUBLIC_CAUSET_APPLICATION!,
        bearerToken: userJwtFromClerk, // from your auth layer
      }}
    >
      {children}
    </CausetProvider>
  );
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 2. Query hook

```tsx
'use client';

import { useCausetQuery } from '@causet/sdk-next';

export function TicketList() {
  const { data, loading, error, refresh } = useCausetQuery(
    'open_tickets',
    { status: 'open' },
    { limit: 20, includeTotal: true },
  );

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Error loading tickets</p>;

  return (
    <ul>
      {data?.items.map((row) => (
        <li key={String(row.id)}>{String(row.subject)}</li>
      ))}
      <button onClick={() => refresh()}>Refresh</button>
    </ul>
  );
}
```

### 3. Intent hook

```tsx
'use client';

import { useCausetIntent } from '@causet/sdk-next';

export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const { intent, pending } = useCausetIntent();

  return (
    <button
      disabled={pending}
      onClick={() => intent('ticket_stream', ticketId, 'CLOSE_TICKET', {})}
    >
      {pending ? 'Closing…' : 'Close ticket'}
    </button>
  );
}
```

### 4. Entity state + WebSocket

```tsx
'use client';

import { useCausetEntity } from '@causet/sdk-next';

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const state = useCausetEntity('ticket_stream', ticketId, true /* connectWs */);

  if (!state) return <p>Loading ticket…</p>;
  return <pre>{JSON.stringify(state, null, 2)}</pre>;
}
```

`useCausetEntity(..., true)` opens a WebSocket to `wss://*.realtime.causet.cloud/ws` and applies live patches to entity state.

### 4b. Manual stream connection (WebSocket or SSE)

```tsx
'use client';

import { useEffect } from 'react';
import { useCausetClient } from '@causet/sdk-next';

export function LiveTicketFeed() {
  const client = useCausetClient();

  useEffect(() => {
    let connId: string | null = null;

    (async () => {
      // WebSocket — all tickets on stream + fork
      connId = await client.connectStream('ticket_stream', {
        channels: [{ channel: 'ledger' }, { channel: 'state' }],
      });

      // Or SSE — single entity
      // connId = await client.connectStream('ticket_stream:tkt_1', { transport: 'sse', fromCursor: 0 });
    })();

    const off = client.on('stream_event', (ev) => {
      console.log(ev.event_type, ev.entity_id, ev.cursor);
    });

    return () => {
      off();
      client.disconnectStream();
    };
  }, [client]);

  return <p>Listening for live ticket events…</p>;
}
```

## WebSocket & SSE

Full protocol reference: [`@causet/sdk-core`](../core/README.md#real-time-streams--websocket--sse).

| Transport | Endpoint | Use when |
|-----------|----------|----------|
| WebSocket | `wss://*.realtime.causet.cloud/ws` | `useCausetEntity`, duplex, lowest latency |
| SSE | `GET .../streams/{streamId}/events?fork_id=` | One-way fanout in client components |

**WebSocket welcome response:**

```json
{"type":"welcome","v":1,"conn_id":"conn_7f3a9b2c","server_ts":1709068800000,"shard":42}
```

**Ledger event (delivered to `stream_event` or applied to entity state):**

```json
{
  "cursor": 42,
  "stream_id": "ticket_stream",
  "entity_id": "tkt_1",
  "fork_id": "main",
  "event_type": "COMMENT_ADDED",
  "patch": [{"op": "add", "path": "/comments/-", "value": {"body": "Customer replied"}}]
}
```

**SSE wire format:**

```
id: 42
event: COMMENT_ADDED
data: {"cursor":42,"stream_id":"ticket_stream","entity_id":"tkt_1","event_type":"COMMENT_ADDED",...}

```

Pass `realtimeUrl` and `streamTransport: 'sse'` in `CausetProvider` options to default to SSE instead of WebSocket.

### 5. Server Route Handler

```ts
// app/api/tickets/route.ts
import { serverRunQuery } from '@causet/sdk-next/server';

export async function GET() {
  const result = await serverRunQuery('open_tickets', { status: 'open' }, {
    limit: 50,
    includeTotal: true,
  });
  return Response.json(result);
}
```

```ts
// app/api/tickets/[id]/close/route.ts
import { serverIntent } from '@causet/sdk-next/server';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const result = await serverIntent(
    'ticket_stream',
    params.id,
    'CLOSE_TICKET',
    {},
  );
  return Response.json(result);
}
```

## Exports

### `@causet/sdk-next` (client)

| Export | Description |
|--------|-------------|
| `CausetProvider` | React context provider |
| `useCausetClient()` | Access underlying `CausetClient` |
| `useCausetQuery(slug, input?, opts?)` | `{ data, loading, error, refresh }` |
| `useCausetIntent()` | `{ intent, intentStream, pending }` |
| `useCausetEntity(stream, entity, connectWs?)` | Live entity state |
| `CausetClient`, `CausetClientOptions`, `QueryResult` | Re-exported types |

### `@causet/sdk-next/server` (server only)

| Export | Description |
|--------|-------------|
| `createServerCausetClient(overrides?)` | Build client from env + overrides |
| `serverRunQuery(slug, input?, config?)` | One-shot query (init → run → destroy) |
| `serverIntent(stream, entity, type, payload, config?)` | One-shot intent |
| `CausetEnvConfig` | Override type for env resolution |

### Env resolution order

`createServerCausetClient` resolves each field:

1. Explicit `overrides` argument
2. `CAUSET_*` env var
3. `NEXT_PUBLIC_CAUSET_*` env var (apiUrl, platform, app only)
4. Default (`apiUrl` → `http://localhost:8085`, `forkId` → `main`)

Throws if `platformSlug` or `appSlug` is missing.

## Hooks reference

### `useCausetQuery`

```tsx
const { data, loading, error, refresh } = useCausetQuery(
  'query_slug',
  { param: 'value' },     // input map (nullable)
  { limit: 30, includeTotal: true },
);
```

Re-fetches when `querySlug`, serialized `input`, `limit`, or `includeTotal` change. Cancels in-flight requests on unmount.

### `useCausetIntent`

```tsx
const { intent, intentStream, pending } = useCausetIntent();

await intent('stream', 'entity', 'INTENT', { key: 'val' });

await intentStream('stream', 'entity', 'INTENT', payload, (ev) => {
  console.log(ev.event, ev.data);
});
```

### `useCausetEntity`

```tsx
const state = useCausetEntity('stream_id', 'entity_id', connectWs?: boolean);
```

Subscribes on mount, listens for `state` events, unsubscribes on unmount. When `connectWs` is `true`, also opens a WebSocket stream for the stream id.

## Server Actions example

```tsx
'use server';

import { serverIntent } from '@causet/sdk-next/server';

export async function closeTicket(ticketId: string) {
  return serverIntent('ticket_stream', ticketId, 'CLOSE_TICKET', {});
}
```

## Full client API

For methods not wrapped by hooks (`listQueries`, `connectStream`, `select`, etc.), use `useCausetClient()`:

```tsx
const client = useCausetClient();
await client.listQueries();
```

See [`@causet/sdk-core` API reference](../core/README.md#api-reference).

## Development

```bash
cd causet-sdks/packages/next

npm run build
npm test              # vitest + jsdom + Testing Library, 100% coverage
npm run test:watch
```

## Related packages

| Package | Use when |
|---------|----------|
| [`@causet/sdk-node`](../node) | Non-Next Node backends |
| [`@causet/sdk`](../js) | Non-React browser apps |
| [`@causet/sdk-core`](../core) | Custom framework integration |

## License

MIT
