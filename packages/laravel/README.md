# causet/laravel-sdk

Laravel package for the [Causet](https://causet.cloud) runtime API. Submit intents, run named queries, and stream live events from Laravel controllers, jobs, and services.

## Status

| | |
| --- | --- |
| **Source** | Available ([`packages/laravel`](.)) |
| **Package distribution** | Source installation only (Packagist not registered) |
| **Maturity** | Experimental |
| **Support** | Not supported |
| **Runtime compatibility** | PHP 8.2+; Laravel 11+ or 12+ |

Primary API: `Causet::submitIntent()` / `$client->submitIntent()`. Deprecated alias: `intent()`.

## Features

- **Service provider** — auto-registers `CausetClient` and `HttpClient` in the container
- **`Causet` Facade** — fluent access from anywhere in your app
- **Config-driven** — `.env` based setup with publishable config file
- Intent submission, intent SSE, live stream SSE (`connectStream`), queries, entity state, selectors
- API key JWT exchange with 401 retry
- Guzzle HTTP client (standard in Laravel)

## Requirements

- PHP 8.2+
- Laravel 11+ or 12+
- Guzzle 7.8+ (included with Laravel)

## Installation

Package distribution is currently **source installation only**. Use a Composer path repository:

Add to your Laravel app's `composer.json`:

```json
{
  "repositories": [
    {
      "type": "path",
      "url": "../causet-sdks/packages/laravel",
      "options": { "symlink": true }
    }
  ],
  "require": {
    "causet/laravel-sdk": "*"
  }
}
```

```bash
composer require causet/laravel-sdk
```

### Publish configuration

```bash
php artisan vendor:publish --tag=causet-config
```

This copies `config/causet.php` to your app.

## Configuration

### Environment variables

```env
CAUSET_API_URL=https://api.causet.cloud
CAUSET_PLATFORM=my-platform
CAUSET_APPLICATION=my-app
CAUSET_FORK=main
CAUSET_API_KEY=ck_live_xxx.secret
CAUSET_BEARER_TOKEN=          # alternative to API key
CAUSET_WS_URL=                # optional — wss://*.realtime.causet.cloud/ws (derived from API URL)
```

### Config file (`config/causet.php`)

```php
return [
    'api_url' => env('CAUSET_API_URL', 'http://localhost:8085'),
    'platform_slug' => env('CAUSET_PLATFORM', ''),
    'app_slug' => env('CAUSET_APPLICATION', ''),
    'fork_id' => env('CAUSET_FORK', 'main'),
    'api_key' => env('CAUSET_API_KEY'),
    'bearer_token' => env('CAUSET_BEARER_TOKEN'),
    'ws_url' => env('CAUSET_WS_URL'),
];
```

## Quick start

### Facade

```php
use Causet\Laravel\Facades\Causet;

// In a controller, job, or command
Causet::init();

$result = Causet::submitIntent('ticket_stream', 'tkt_1', 'CREATE_TICKET', [
    'customer_id' => 'cust_1',
    'subject' => 'Billing question',
    'body' => 'I was charged twice.',
], intentId: 'create-ticket-tkt_1');

if ($result['accepted']) {
    $rows = Causet::runQuery('open_tickets', ['status' => 'open'], limit: 20);
}
```

### Dependency injection

```php
use Causet\Laravel\CausetClient;

class TicketController extends Controller
{
    public function __construct(private CausetClient $causet) {}

    public function index()
    {
        $this->causet->init();

        return response()->json(
            $this->causet->runQuery('open_tickets', [], limit: 50)
        );
    }

    public function close(string $ticketId)
    {
        $this->causet->init();

        return response()->json(
            $this->causet->intent('ticket_stream', $ticketId, 'CLOSE_TICKET', [])
        );
    }
}
```

### Manual instantiation (testing / scripts)

```php
use Causet\Laravel\CausetClient;
use Causet\Laravel\Http\HttpClient;
use GuzzleHttp\Client;

$http = new Client;
$client = new CausetClient(
    new HttpClient($http),
    $http,
    apiUrl: 'https://api.causet.cloud',
    platformSlug: 'my-platform',
    appSlug: 'my-app',
    apiKey: config('causet.api_key'),
);

$client->init();
```

## API reference

### Lifecycle

```php
$client->init();     // eager API key exchange
$client->destroy();  // cleanup
$token = $client->getTokenPublic();
```

### Entity state

```php
$client->subscribe('stream_id', 'entity_id');
$state = $client->getState('stream_id', 'entity_id');  // array|null
$client->unsubscribe('stream_id', 'entity_id');
$client->fetchState('stream_id', 'entity_id');
$client->listEntities(streamName: 'orders', limit: 50);
```

### Intents

```php
$result = $client->submitIntent(
    'stream_id',
    'entity_id',
    'INTENT_TYPE',
    ['key' => 'value'],
    intentId: 'optional-idempotency-key',
);
// ['accepted' => bool, 'execution_id' => ?, 'error' => ?, 'state_patch' => ?]

$client->intentStream(
    'stream_id', 'entity_id', 'INTENT_TYPE', $payload,
    function (array $ev): void {
        logger()->info($ev['event'] ?? 'message', $ev['data'] ?? []);
    },
);
```

### Queries

```php
$client->runQuery('query_slug', ['param' => 'value'], limit: 30, includeTotal: true);
$client->runQuery('query_slug', null, cursor: 'abc123');
$client->listQueries();
$client->getQueryDefinition('query_slug');
$client->listProjections();
```

### Selectors and events

```php
$unsub = $client->select(
    'stream_id', 'entity_id',
    fn (array $state) => $state['total'] ?? 0,
    fn ($total) => logger()->info("Total: $total"),
);

$off = $client->on('state', function ($ev) { /* ... */ });
$off();
```

## WebSocket & SSE

The Laravel SDK wraps REST, intent submission, **intent SSE** (`intentStream`), and **live stream events** via `connectStream()` (SSE transport). URLs are derived from your API URL:

```php
use Causet\Laravel\Auth\ApiKeyTokenManager;

$realtimeUrl = ApiKeyTokenManager::deriveRealtimeUrl(config('causet.api_url'));
$wsUrl = ApiKeyTokenManager::deriveWsUrl(config('causet.api_url'));
// Sandbox: https://sandbox.realtime.causet.cloud → wss://sandbox.realtime.causet.cloud/ws
```

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

### Intent SSE (wrapped — `intentStream`)

Stream intent execution progress from the runtime API:

```php
Causet::intentStream('ticket_stream', 'tkt_1', 'PROCESS_REFUND', ['amount_cents' => 5000], function (array $ev): void {
    // $ev = ['id' => '1', 'event' => 'COMPLETE', 'data' => [...]]
    logger()->info($ev['event'] ?? 'message', $ev['data'] ?? []);
});
```

**Example SSE wire response (intent progress):**

```
id: 1
event: START
data: {"execution_id":"exec_abc","intent_type":"PROCESS_REFUND"}

id: 2
event: COMPLETE
data: {"accepted":true,"execution_id":"exec_abc","state_patch":[{"op":"replace","path":"/status","value":"refunded"}]}

```

### Stream SSE (live ledger — `connectStream`)

`connectStream()` consumes causet-realtime's SSE endpoint directly — no manual Guzzle wiring needed. It **blocks the calling process** for the connection's lifetime, so use it from a queue job or `artisan` command, not a web request handler:

```php
use Causet\Laravel\Facades\Causet;

Causet::init();

Causet::on('stream_event', function (array $ev): void {
    logger()->info($ev['event_type'] ?? 'event', $ev);
});

// Stream + fork + entity, resume from cursor 0
Causet::connectStream('sku_stream:sku-1', function (array $ev): void {
    // Called for every ledger patch / projection write, same JSON shape as WebSocket events
    logger()->info($ev['event_type'] ?? 'event', $ev);
}, forkId: 'sandbox', fromCursor: 0);
```

Stop the loop from a signal handler in long-running commands:

```php
pcntl_async_signals(true);
pcntl_signal(SIGTERM, fn () => Causet::disconnectStream());

Causet::connectStream('sku_stream', $onEvent);
```

Or pass a custom `$shouldStop` callback checked between reads:

```php
Causet::connectStream('sku_stream', $onEvent, shouldStop: fn (): bool => Cache::get('stop-worker', false));
```

**Example wire response (what causet-realtime sends):**

```
id: 42
event: STOCK_ADJUSTED
data: {"cursor":42,"stream_id":"sku_stream","entity_id":"sku-1","fork_id":"sandbox","event_type":"STOCK_ADJUSTED","patch":[{"op":"replace","path":"/quantity","value":95}]}

```

`connectStream()` parses each `data:` line and calls your handler with the decoded JSON — the `stream_event` handler registered via `on()` fires too.

### WebSocket (live ledger — protocol reference)

There is no wrapped WebSocket client in this SDK (Laravel/Guzzle is synchronous). Use `connectStream()` (SSE) above, or connect to `wss://sandbox.realtime.causet.cloud/ws?token={jwt}` with a WebSocket client library (e.g. `textalk/websocket`) in a long-running worker and send a hello as the first message:

```json
{"type":"hello","v":1,"stream_id":"sku_stream","fork_id":"sandbox","subs":[{"channel":"ledger"},{"channel":"state"}]}
```

**Welcome response:**

```json
{"type":"welcome","v":1,"conn_id":"conn_7f3a9b2c","server_ts":1709068800000,"shard":42}
```

**Ledger event:**

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

## Facade methods

All methods on `CausetClient` are available via the `Causet` facade:

```php
Causet::init();
Causet::submitIntent(...);
Causet::intentStream(...);
Causet::connectStream(...);
Causet::disconnectStream();
Causet::runQuery(...);
Causet::subscribe(...);
Causet::getState(...);
Causet::listQueries();
Causet::fetchState(...);
Causet::select(...);
Causet::on(...);
```

## Error handling

```php
use Causet\Laravel\Exceptions\CausetApiException;
use Causet\Laravel\Exceptions\CausetAuthException;

try {
    Causet::submitIntent(...);
} catch (CausetApiException $e) {
    report($e);
    return response()->json(['error' => $e->getMessage()], $e->statusCode);
} catch (CausetAuthException $e) {
    return response()->json(['error' => 'Causet auth failed'], 401);
}
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

## Testing your app

Mock the client in Laravel tests:

```php
use Causet\Laravel\CausetClient;
use Mockery;

$this->mock(CausetClient::class, function ($mock) {
    $mock->shouldReceive('init');
    $mock->shouldReceive('runQuery')->andReturn(['items' => []]);
});
```

## Package development

```bash
cd causet-sdks/packages/laravel

composer install
composer test              # PHPUnit, 100% coverage on src/
composer test:coverage     # requires Xdebug: XDEBUG_MODE=coverage
```

### Project structure

```
src/
  CausetClient.php           # Main client
  CausetServiceProvider.php  # Laravel provider
  Facades/Causet.php         # Facade
  Http/HttpClient.php        # REST layer
  Http/CausetHttpConfig.php  # Config value object
  Auth/ApiKeyTokenManager.php
  Transport/SseTransport.php
  Support/Emitter.php
  Support/Patch.php
  Support/QueryProjection.php
  Exceptions/                # CausetException hierarchy
config/causet.php
tests/Unit/
tests/Feature/
```

## Related packages

| Package | Runtime |
|---------|---------|
| [`causet-sdk`](../python) | Python async/sync |
| [`@causet/sdk-core`](../core) | TypeScript |
| [`@causet/sdk-next`](../next) | Next.js |

## License

MIT
