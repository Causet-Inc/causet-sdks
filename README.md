# Causet SDKs

Official client libraries for the [Causet](https://causet.cloud) event-sourcing platform. Submit intents, run named projection queries, stream SSE intent progress, and receive real-time ledger patches via **WebSocket** or **SSE** (fork-aware: stream + fork, or stream + fork + entity).

This repository contains SDKs for JavaScript/TypeScript, Python, Go, Java, and PHP (Laravel).

## Packages

| Package | Language | Install | Documentation |
|---------|----------|---------|---------------|
| [`@causet/sdk-core`](packages/core) | TypeScript | `npm i @causet/sdk-core` | [README](packages/core/README.md) |
| [`@causet/sdk`](packages/js) | JavaScript (ESM) | `npm i @causet/sdk` | [README](packages/js/README.md) |
| [`@causet/sdk-node`](packages/node) | Node.js 18+ | `npm i @causet/sdk-node` | [README](packages/node/README.md) |
| [`@causet/sdk-next`](packages/next) | Next.js + React | `npm i @causet/sdk-next` | [README](packages/next/README.md) |
| [`causet-sdk`](packages/python) | Python 3.10+ | `pip install causet-sdk` | [README](packages/python/README.md) |
| [`causet-sdk-go`](packages/go) | Go 1.22+ | `go get github.com/causet-inc/causet-sdk-go` | [README](packages/go/README.md) |
| [`causet-sdk`](packages/java) | Java 17+ | Maven `com.causet:causet-sdk` | [README](packages/java/README.md) |
| [`causet/laravel-sdk`](packages/laravel) | PHP / Laravel 11+ | `composer require causet/laravel-sdk` | [README](packages/laravel/README.md) |

### Which package should I use?

| Your stack | Package |
|------------|---------|
| Browser / Vite / React (non-Next) | `@causet/sdk` |
| Node.js script, Express, Fastify | `@causet/sdk-node` |
| Next.js App Router | `@causet/sdk-next` |
| Custom TS framework / library author | `@causet/sdk-core` |
| Python asyncio, FastAPI, Django async | `causet-sdk` (`CausetClient`) |
| Python scripts / sync code | `causet-sdk` (`CausetClientSync`) |
| Go services, CLIs, workers | `causet-sdk-go` |
| JVM / Spring / Kotlin | `com.causet:causet-sdk` |
| Laravel | `causet/laravel-sdk` |

## What Causet SDKs do

Causet is an event-sourcing platform. Your application DSL defines **streams**, **entities**, **intents**, **projections**, and **queries**. The SDKs talk to **causet-saas-cloud**, which proxies to the runtime and query services.

```
┌─────────────┐     HTTPS/WSS      ┌──────────────────┐     ┌─────────────────┐
│  Your app   │ ◄──────────────► │ causet-saas-cloud│ ──► │ Runtime / Query │
│  (SDK)      │   intents/queries│  (port 8085)     │     │ services        │
└─────────────┘                  └──────────────────┘     └─────────────────┘
```

### Core capabilities (all SDKs)

| Capability | Description |
|------------|-------------|
| **Submit intent** | Send a typed action to mutate entity state |
| **SSE streaming** | Receive `START`, `COMPLETE`, `ERROR` events during intent execution |
| **Run query** | Execute a named projection query with filters and pagination |
| **Entity state** | Fetch and cache entity snapshots; apply JSON patches locally |
| **WebSocket** | Stream + fork or stream + fork + entity via causet-realtime `hello` |
| **SSE streams** | Same subscription model over `GET .../streams/{id}/events?fork_id=` |
| **API key auth** | Exchange `ck_live_...` for a short-lived JWT automatically |

## Quick start

### TypeScript / JavaScript

```bash
npm install @causet/sdk
```

```javascript
import { CausetClient } from '@causet/sdk';

const client = new CausetClient({
  apiUrl: 'https://api.causet.cloud',
  platformSlug: 'my-platform',
  appSlug: 'my-app',
  apiKey: process.env.CAUSET_API_KEY,
});
await client.init();

await client.emit('ticket_stream', 'tkt_1', 'CREATE_TICKET', {
  subject: 'Help',
  body: 'Need assistance',
});

const { items } = await client.runQuery('open_tickets', {}, { limit: 20 });
client.destroy();
```

### Python

```bash
pip install causet-sdk
```

```python
from causet_sdk import CausetClient

client = CausetClient(
    api_url="https://api.causet.cloud",
    platform_slug="my-platform",
    app_slug="my-app",
    api_key="ck_live_xxx.secret",
)
await client.init()
await client.emit("ticket_stream", "tkt_1", "CREATE_TICKET", {...})
rows = await client.run_query("open_tickets", {}, limit=20)
```

### Laravel

```php
use Causet\Laravel\Facades\Causet;

Causet::init();
Causet::emit('ticket_stream', 'tkt_1', 'CREATE_TICKET', ['subject' => 'Help']);
$rows = Causet::runQuery('open_tickets', [], limit: 20);
```

See each package README for full examples, hooks, server helpers, and sync APIs.

## Authentication

Cloud API keys use the format `ck_live_<prefix>.<secret>`.

1. Exchange the key: `POST /v1/token` with `Authorization: ApiKey ck_live_...`
2. Use the returned JWT as `Authorization: Bearer <token>` on all subsequent requests
3. Refresh ~30 seconds before expiry (default TTL: 300 seconds)

All SDKs handle this automatically when you pass `apiKey` / `api_key` / `CAUSET_API_KEY`.

For user-facing browser apps, use a session JWT (`bearerToken`) instead of embedding API keys.

## HTTP API reference

| Operation | Method | Path |
|-----------|--------|------|
| Token exchange | `POST` | `/v1/token` |
| Submit intent | `POST` | `/v1/runtime/platforms/{platform}/applications/{app}/intents/submit` |
| Intent SSE | `POST` | `/v1/runtime/stream/platforms/{platform}/applications/{app}/intents/submit` |
| Entity state | `GET` | `/v1/platforms/{platform}/applications/{app}/entities/{stream}/{id}/state` |
| Run query | `POST` | `/v1/platforms/{platform}/applications/{app}/forks/{fork}/queries/{slug}/run` |
| WebSocket | `WS` | `wss://*.realtime.causet.cloud/ws` — hello with `stream_id`, `fork_id` |
| Stream SSE | `GET` | `{realtimeUrl}/v1/platforms/{platform}/applications/{app}/streams/{streamId}/events?fork_id=` |

See each package README for language-specific WebSocket and SSE examples.

## Development

### Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (3.13 recommended)
- Go 1.22+
- Java 17+ and Maven (Java package)
- PHP 8.2+ and Composer (Laravel package only)

### Setup

```bash
git clone https://github.com/Causet-Inc/causet-sdks.git
cd causet-sdks

# JavaScript / TypeScript
npm install
npm run build
npm test

# Python
cd packages/python
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest --cov=causet_sdk --cov-fail-under=100

# Go
cd packages/go && go test ./...

# Java
cd packages/java && mvn test

# Laravel
cd packages/laravel
composer install
composer test
```

### Workspace scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all TypeScript packages (`core` → `js` → `node` → `next`) |
| `npm test` | Run Vitest across all JS workspaces (100% coverage enforced) |
| `npm run test:php` | Run Laravel PHPUnit suite |
| `npm run publish:dry-run` | Validate npm publish (dry-run all workspaces) |

Build order matters: `@causet/sdk-core` must build before dependent packages.

### Publishing

See **[docs/PUBLISHING.md](docs/PUBLISHING.md)** for npm, PyPI, Go, Maven, and Packagist release steps.

### Project layout

```
causet-sdks/
├── package.json              # npm workspaces root
├── packages/
│   ├── core/                 # @causet/sdk-core — shared TS implementation
│   ├── js/                   # @causet/sdk — browser ESM
│   ├── node/                 # @causet/sdk-node — Node.js helper
│   ├── next/                 # @causet/sdk-next — React hooks + server
│   ├── python/               # causet-sdk — Python async + sync
│   ├── go/                   # causet-sdk-go — Go client
│   ├── java/                 # causet-sdk — Java client
│   └── laravel/              # causet/laravel-sdk — Laravel provider
└── README.md                 # this file
```

## Test coverage

All packages enforce **100% unit test coverage** where applicable:

| Package | Runner | Gate |
|---------|--------|------|
| `@causet/sdk-core` | Vitest + v8 | 100% statements/branches/functions/lines |
| `@causet/sdk` | Vitest + v8 | 100% |
| `@causet/sdk-node` | Vitest + v8 | 100% |
| `@causet/sdk-next` | Vitest + jsdom | 100% |
| `causet-sdk` | pytest-cov | `--cov-fail-under=100` |
| `causet/laravel-sdk` | PHPUnit | 100% on `src/` (Xdebug) |

## Configuration reference

Common options across SDKs:

| Option | Env var(s) | Description |
|--------|------------|-------------|
| API URL | `CAUSET_API_URL` | SaaS base URL (default `http://localhost:8085`) |
| Platform | `CAUSET_PLATFORM` | Platform slug |
| Application | `CAUSET_APPLICATION` | Application slug |
| Fork | `CAUSET_FORK` | Fork id for intents, state, streams (default `main`) |
| Realtime URL | `CAUSET_REALTIME_URL` | HTTP base for SSE stream events |
| WebSocket URL | `CAUSET_WS_URL` | WebSocket endpoint |
| Stream transport | `CAUSET_STREAM_TRANSPORT` | `websocket` or `sse` (SDKs that support it) |
| API key | `CAUSET_API_KEY` | Cloud API key (server-side) |
| Bearer token | `CAUSET_BEARER_TOKEN` | Static JWT alternative |

Next.js also supports `NEXT_PUBLIC_CAUSET_*` for client-safe values (never expose API keys via `NEXT_PUBLIC_`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
