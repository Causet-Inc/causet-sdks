# Causet SDKs

Official and experimental SDKs for submitting intents, reading state, querying projections, and integrating applications with [Causet](https://causet.cloud).

SDKs in this repository have different levels of package availability, maturity, and support. Check the matrix below before adopting one.

**Documentation:** [docs.causet.io](https://docs.causet.io) · **Support:** [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues) · **License:** [MIT](LICENSE)

## SDK status

Authoritative machine-readable status: [`docs/sdk-status.json`](docs/sdk-status.json). Run `node scripts/validate-sdk-status.mjs` to detect documentation drift.

| SDK | Source | Package distribution | Maturity | Support | Runtime compatibility |
| --- | ------ | -------------------- | -------- | ------- | --------------------- |
| [JavaScript / TypeScript](packages/js/README.md) | Available | Published to npm (`@causet/sdk` **0.2.0**, `@causet/sdk-core`, `@causet/sdk-node`, `@causet/sdk-next`) | Supported preview | Supported for pilots | Node.js 18+ (ESM); browsers with `fetch`; TypeScript 5+ |
| [Python](packages/python/README.md) | Available | Source installation only | Preview | Community or best effort | Python 3.10+ |
| [Java](packages/java/README.md) | Available | Source installation only — **Maven Central coming soon** | Preview | Community or best effort | Java 17+ |
| [PHP (Laravel)](packages/laravel/README.md) | Available | Source installation only | Experimental | Not supported | PHP 8.2+; Laravel 11+ or 12+ |
| [Go](packages/go/README.md) | Available | Source installation only | Experimental | Not supported | Go 1.22+ |
| Rust | Not available | Not published | Planned | Not supported | — |

### npm packages

The following packages are published to npm:

- `@causet/sdk`
- `@causet/sdk-core`
- `@causet/sdk-node`
- `@causet/sdk-next`

Latest verified npm version: **0.2.0**

```bash
npm install @causet/sdk          # browser / bundler apps
npm install @causet/sdk-node     # Node.js backends
npm install @causet/sdk-next     # Next.js + React
npm install @causet/sdk-core     # low-level TypeScript client
```

Packages **not** on public registries yet: `causet-sdk` (PyPI — not published yet), `com.causet:causet-sdk` (Maven Central — coming soon), `causet/laravel-sdk` (Packagist), `github.com/causet-inc/causet-sdk-go` (Go module). Use source installation from this repository until a release is announced.

## Which package should I use?

| Your stack | Package | Status |
|------------|---------|--------|
| Browser / Vite / React (non-Next) | `@causet/sdk` | npm 0.2.0 |
| Node.js script, Express, Fastify | `@causet/sdk-node` | npm 0.2.0 |
| Next.js App Router | `@causet/sdk-next` | npm 0.2.0 |
| Custom TS framework / library author | `@causet/sdk-core` | npm 0.2.0 |
| Python asyncio, FastAPI, Django async | `causet-sdk` | source only |
| Python scripts / sync code | `causet-sdk` (`CausetClientSync`) | source only |
| Go services, CLIs, workers | `causet-sdk-go` | source only |
| JVM / Spring / Kotlin | `com.causet:causet-sdk` | source only |
| Laravel | `causet/laravel-sdk` | source only |

## What Causet SDKs do

Causet is a deterministic runtime and compiler for stateful backend workflows. Your application DSL defines **streams**, **entities**, **intents**, **projections**, and **queries**. SDKs call the **Causet Cloud gateway** (Managed Causet Cloud or a local management API), which proxies to the **runtime API** and query services.

```
┌─────────────┐     HTTPS/WSS      ┌────────────────────┐     ┌─────────────────┐
│  Your app   │ ◄──────────────► │ Causet Cloud       │ ──► │ Runtime / Query │
│  (SDK)      │   intents/queries│ gateway            │     │ services        │
└─────────────┘                  └────────────────────┘     └─────────────────┘
```

Committed **business events** appear on the realtime service after the runtime accepts and processes an intent. SDK methods named `submitIntent` (or language equivalent) **submit an intent** — they do not directly append a committed event.

### Core capabilities

| Capability | Description |
|------------|-------------|
| **Submit intent** | Send a typed action to mutate entity state via the runtime API |
| **SSE streaming** | Receive `START`, `COMPLETE`, `ERROR` events during intent execution |
| **Run query** | Execute a named projection query with filters and pagination |
| **Entity state** | Fetch and cache entity snapshots; apply JSON patches locally |
| **WebSocket / SSE** | Stream + fork, or stream + fork + entity via the realtime service |
| **API key auth** | Exchange `ck_live_...` for a short-lived JWT automatically |

## Quick start (JavaScript / TypeScript)

```bash
npm install @causet/sdk
```

```typescript
import { CausetClient } from '@causet/sdk';

const client = new CausetClient({
  apiUrl: process.env.CAUSET_API_URL!,
  platformSlug: process.env.CAUSET_PLATFORM!,
  appSlug: process.env.CAUSET_APPLICATION!,
  apiKey: process.env.CAUSET_API_KEY,
});

await client.init();

const result = await client.submitIntent(
  'ticket_stream',
  'tkt_1',
  'CREATE_TICKET',
  { subject: 'Help', body: 'Need assistance' },
  'create-ticket-tkt_1-001', // optional idempotency key (intentId)
);

if (!result.accepted) {
  throw new Error(result.error ?? 'Intent not accepted');
}

await client.subscribe('ticket_stream', 'tkt_1');
console.log(client.getState('ticket_stream', 'tkt_1'));

const { items } = await client.runQuery('open_tickets', {}, { limit: 20 });
client.destroy();
```

`intent()` and `emit()` remain as deprecated aliases on `CausetClient`.

See each package README for Python, Java, PHP, Go, hooks, server helpers, and sync APIs.

## Authentication

Cloud API keys use the format `ck_live_<prefix>.<secret>`.

1. Exchange the key: `POST /v1/token` with `Authorization: ApiKey ck_live_...`
2. Use the returned JWT as `Authorization: Bearer <token>` on subsequent requests
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
| WebSocket | `WS` | `wss://*.realtime.causet.cloud/ws` |
| Stream SSE | `GET` | `{realtimeUrl}/v1/platforms/{platform}/applications/{app}/streams/{streamId}/events?fork_id=` |

## Support

**GitHub Issues are the official support channel** for SDK bugs, questions, and feature requests. See [SUPPORT.md](SUPPORT.md) for templates and guidance.

- [Open an issue](https://github.com/Causet-Inc/causet-sdks/issues/new/choose)
- [Causet platform documentation](https://docs.causet.io)
- Security vulnerabilities: [SECURITY.md](SECURITY.md) (private report — not public issues)

### Support definitions

### Supported

Maintained in this repository with documented compatibility. Support is provided via [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues) on a best-effort basis.

### Supported for pilots

The JavaScript / TypeScript npm packages at **0.2.0** are available for pilot integrations. Report issues on GitHub; APIs may still change between minor releases while in preview.

### Community or best effort

Source and tests are maintained in this repository. Support via GitHub Issues; release cadence and registry publishing are not guaranteed.

### Experimental

Available for evaluation from source. Compatibility and turnaround on GitHub Issues are not guaranteed.

### Not supported

No maintenance or compatibility commitments. May be removed or rewritten without notice.

## Compatibility policy

- **Versioning:** Packages use [semantic versioning](https://semver.org/) in manifests (`0.2.0` today). While major version is `0`, minor releases may include breaking API changes; treat `0.x` as preview.
- **Runtime compatibility:** Each SDK README documents supported language and framework versions. The status matrix above is the source of truth for which SDK works with which runtime.
- **Breaking changes:** Announced in GitHub Release notes. Deprecated methods (for example `intent()`, `emit()`) remain for at least one minor release where feasible.
- **Support window:** Only the latest `0.x` npm release is intended for pilot use. Older SDK releases receive no compatibility guarantees.
- **Preview / experimental SDKs:** Python, Java, PHP, and Go source packages receive **no** compatibility guarantees until promoted to a supported distribution channel.

## Development

### Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (3.13 recommended)
- Go 1.22+
- Java 17+ and Maven (Java package)
- PHP 8.2+ and Composer (Laravel package)

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
| `node scripts/validate-sdk-status.mjs` | Validate README vs `docs/sdk-status.json` and npm registry |
| `npm run publish:dry-run` | Validate npm publish (dry-run all workspaces) |

Build order matters: `@causet/sdk-core` must build before dependent packages.

### Publishing

See **[docs/PUBLISHING.md](docs/PUBLISHING.md)** for npm, PyPI, Go, Maven, and Packagist release steps.

### Project layout

```
causet-sdks/
├── docs/
│   ├── sdk-status.json       # authoritative SDK status
│   └── PUBLISHING.md
├── scripts/
│   └── validate-sdk-status.mjs
├── package.json              # npm workspaces root
├── packages/
│   ├── core/                 # @causet/sdk-core
│   ├── js/                   # @causet/sdk
│   ├── node/                 # @causet/sdk-node
│   ├── next/                 # @causet/sdk-next
│   ├── python/               # causet-sdk
│   ├── go/                   # causet-sdk-go (source)
│   ├── java/                 # com.causet:causet-sdk (source)
│   └── laravel/              # causet/laravel-sdk (source)
└── README.md
```

## Test coverage

| Package | Runner | Gate |
|---------|--------|------|
| `@causet/sdk-core` | Vitest + v8 | 100% statements/branches/functions/lines |
| `@causet/sdk` | Vitest + v8 | 100% |
| `@causet/sdk-node` | Vitest + v8 | 100% |
| `@causet/sdk-next` | Vitest + jsdom | 100% |
| `causet-sdk` (Python) | pytest-cov | `--cov-fail-under=100` |
| `causet/laravel-sdk` | PHPUnit | CI (`composer test:ci`) |
| Go / Java | `go test` / `mvn test` | unit tests in CI |

## Configuration reference

| Option | Env var(s) | Description |
|--------|------------|-------------|
| API URL | `CAUSET_API_URL` | Causet Cloud gateway base URL (default `http://localhost:8085` for local management API) |
| Platform | `CAUSET_PLATFORM` | Platform slug |
| Application | `CAUSET_APPLICATION` | Application slug |
| Fork | `CAUSET_FORK` | Fork id for intents, state, streams (default `main`) |
| Realtime URL | `CAUSET_REALTIME_URL` | HTTP base for SSE stream events |
| WebSocket URL | `CAUSET_WS_URL` | WebSocket endpoint |
| Stream transport | `CAUSET_STREAM_TRANSPORT` | `websocket` or `sse` |
| API key | `CAUSET_API_KEY` | Cloud API key (server-side) |
| Bearer token | `CAUSET_BEARER_TOKEN` | Static JWT alternative |

Next.js also supports `NEXT_PUBLIC_CAUSET_*` for client-safe values (never expose API keys via `NEXT_PUBLIC_`).

## Open source

This repository is open source under the [MIT License](LICENSE).

| Resource | Purpose |
|----------|---------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [SUPPORT.md](SUPPORT.md) | Support via GitHub Issues |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [docs.causet.io](https://docs.causet.io) | Platform documentation |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Support: [SUPPORT.md](SUPPORT.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
