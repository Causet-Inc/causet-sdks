<?php

namespace Causet\Laravel;

use Causet\Laravel\Auth\ApiKeyTokenManager;
use Causet\Laravel\Exceptions\CausetApiException;
use Causet\Laravel\Exceptions\CausetException;
use Causet\Laravel\Http\CausetHttpConfig;
use Causet\Laravel\Http\HttpClient;
use Causet\Laravel\Support\Emitter;
use Causet\Laravel\Support\Patch;
use Causet\Laravel\Transport\SseTransport;
use GuzzleHttp\ClientInterface;

class CausetClient
{
    private readonly Emitter $emitter;

    /** @var array<string, array{state: array<string, mixed>, cursor: int}> */
    private array $subscriptions = [];

    /** @var array<int, array{streamId: string, entityId: string, selector: callable, handler: callable, lastValue: mixed}> */
    private array $selectors = [];

    private ?ApiKeyTokenManager $tokenManager = null;

    public readonly string $apiUrl;
    public readonly string $platformSlug;
    public readonly string $appSlug;
    public readonly string $forkId;
    public readonly string $wsUrl;
    public readonly string $realtimeUrl;

    private bool $streamStopRequested = false;

    public function __construct(
        private readonly HttpClient $httpClient,
        private readonly ClientInterface $http,
        string $apiUrl,
        string $platformSlug,
        string $appSlug,
        string $forkId = 'main',
        ?string $wsUrl = null,
        private string $bearerToken = '',
        private string $apiKey = '',
        ?string $realtimeUrl = null,
    ) {
        $this->apiUrl = $apiUrl;
        $this->platformSlug = $platformSlug;
        $this->appSlug = $appSlug;
        $this->forkId = $forkId;
        $this->realtimeUrl = $realtimeUrl ?? ApiKeyTokenManager::deriveRealtimeUrl($apiUrl);
        $this->wsUrl = $wsUrl ?? ApiKeyTokenManager::deriveWsUrlFromRealtime($this->realtimeUrl);
        $this->emitter = new Emitter();

        if ($this->apiKey !== '') {
            $this->tokenManager = new ApiKeyTokenManager($apiUrl, $this->apiKey, $this->http);
        }
    }

    private function subKey(string $streamId, string $entityId): string
    {
        return "{$streamId}:{$entityId}";
    }

    private function getToken(): ?string
    {
        if ($this->tokenManager !== null) {
            return $this->tokenManager->getToken();
        }

        return $this->bearerToken !== '' ? $this->bearerToken : null;
    }

    public function getTokenPublic(): string
    {
        $token = $this->getToken();
        if ($token === null) {
            throw new CausetException('No Causet token — set api_key or bearer_token');
        }

        return $token;
    }

    private function httpConfig(?string $token = null): CausetHttpConfig
    {
        return new CausetHttpConfig(
            $this->apiUrl,
            $this->platformSlug,
            $this->appSlug,
            $this->forkId,
            $token ?? '',
        );
    }

    /**
     * @template T
     * @param  callable(CausetHttpConfig): T  $fn
     * @return T
     */
    private function runWithRetry(callable $fn): mixed
    {
        $token = $this->getToken();
        try {
            return $fn($this->httpConfig($token));
        } catch (CausetApiException $e) {
            if ($e->statusCode !== 401 || $this->tokenManager === null) {
                throw $e;
            }
            $this->tokenManager->forceRefresh();
            $token2 = $this->getToken();

            return $fn($this->httpConfig($token2));
        }
    }

    public function init(): void
    {
        $this->tokenManager?->init();
    }

    public function destroy(): void
    {
        $this->tokenManager?->destroy();
    }

    public function on(string $eventType, callable $handler): callable
    {
        return $this->emitter->on($eventType, $handler);
    }

    public function subscribe(string $streamId, string $entityId): void
    {
        $result = $this->runWithRetry(
            fn (CausetHttpConfig $cfg): array => $this->httpClient->fetchState($cfg, $streamId, $entityId)
        );

        $state = is_array($result['state']) ? $result['state'] : [];
        $this->subscriptions[$this->subKey($streamId, $entityId)] = [
            'state' => json_decode(json_encode($state), true),
            'cursor' => (int) $result['cursor'],
        ];

        $this->emitter->emit('state', [
            'streamId' => $streamId,
            'entityId' => $entityId,
            'state' => $this->getState($streamId, $entityId),
        ]);
        $this->notifySelectors($streamId, $entityId);
    }

    public function unsubscribe(string $streamId, string $entityId): void
    {
        unset($this->subscriptions[$this->subKey($streamId, $entityId)]);
        $this->selectors = array_values(array_filter(
            $this->selectors,
            fn (array $e): bool => ! ($e['streamId'] === $streamId && $e['entityId'] === $entityId)
        ));
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getState(string $streamId, string $entityId): ?array
    {
        $sub = $this->subscriptions[$this->subKey($streamId, $entityId)] ?? null;
        if ($sub === null) {
            return null;
        }

        return json_decode(json_encode($sub['state']), true);
    }

    /**
     * Submit an intent to the Causet runtime.
     *
     * @param  array<string, mixed>  $payload
     * @return array{accepted: bool, execution_id?: string, error?: string, state_patch?: mixed}
     */
    public function submitIntent(
        string $streamId,
        string $entityId,
        string $intentType,
        array $payload,
        ?string $intentId = null,
    ): array {
        $result = $this->runWithRetry(
            fn (CausetHttpConfig $cfg): array => $this->httpClient->submitIntent(
                $cfg,
                $streamId,
                $entityId,
                $intentType,
                $payload,
                $intentId,
            )
        );

        if ($result['accepted']) {
            $this->refreshSubscriptionAfterIntent($streamId, $entityId, $result);
        }

        return $result;
    }

    /**
     * @deprecated Use submitIntent(). Submits an intent to the runtime; does not
     * directly append a committed business event.
     *
     * @param  array<string, mixed>  $payload
     * @return array{accepted: bool, execution_id?: string, error?: string, state_patch?: mixed}
     */
    public function intent(
        string $streamId,
        string $entityId,
        string $intentType,
        array $payload,
        ?string $intentId = null,
    ): array {
        return $this->submitIntent($streamId, $entityId, $intentType, $payload, $intentId);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  callable(array{id: ?string, event: ?string, data: mixed}): void  $onEvent
     */
    public function intentStream(
        string $streamId,
        string $entityId,
        string $intentType,
        array $payload,
        callable $onEvent,
        ?string $intentId = null,
    ): void {
        $token = $this->getTokenPublic();
        $body = [
            'forkId' => $this->forkId,
            'streamId' => $streamId,
            'entityId' => $entityId,
            'intentType' => $intentType,
            'payload' => $payload,
        ];
        if ($intentId !== null) {
            $body['intentId'] = $intentId;
        }

        $this->runWithRetry(function (CausetHttpConfig $cfg) use ($body, $onEvent): void {
            SseTransport::submitIntentStream($cfg, $body, $onEvent, $this->http);
        });
    }

    /**
     * Consume live ledger/projection events from causet-realtime over SSE.
     *
     * Blocks the calling process for the connection's lifetime — use in queue
     * workers, artisan commands, or long-running scripts, not web request handlers.
     *
     * `$streamId` is `streamType` (all entities) or `streamType:entityId` (one entity).
     *
     * @param  callable(array<string, mixed>): void  $onEvent
     * @param  (callable(): bool)|null  $shouldStop  Checked between reads; return true to stop the loop
     */
    public function connectStream(
        string $streamId,
        callable $onEvent,
        ?string $forkId = null,
        int $fromCursor = 0,
        ?callable $shouldStop = null,
    ): void {
        $token = $this->getTokenPublic();
        $this->streamStopRequested = false;

        $this->emitter->emit('stream_connecting', ['streamId' => $streamId, 'transport' => 'sse']);

        SseTransport::connectStream(
            $this->realtimeUrl,
            $this->platformSlug,
            $this->appSlug,
            $streamId,
            $forkId ?? $this->forkId,
            $fromCursor,
            $token,
            function (array $event) use ($streamId, $onEvent): void {
                $this->emitter->emit('stream_event', ['streamId' => $streamId, 'event' => $event]);
                $onEvent($event);
            },
            $this->http,
            fn (): bool => $this->streamStopRequested || ($shouldStop !== null && $shouldStop()),
        );

        $this->emitter->emit('stream_closed', ['streamId' => $streamId]);
    }

    /**
     * Signal a running `connectStream()` loop to stop after the current read.
     * Since `connectStream()` blocks the calling process, call this from a
     * signal handler (e.g. `pcntl_signal` with `pcntl_async_signals(true)`)
     * or a custom `$shouldStop` callback passed to `connectStream()` instead.
     */
    public function disconnectStream(): void
    {
        $this->streamStopRequested = true;
    }

    /**
     * @param  array<string, mixed>|null  $input
     * @return array<string, mixed>
     */
    public function runQuery(
        string $querySlug,
        ?array $input = null,
        ?int $limit = null,
        ?int $offset = null,
        ?string $cursor = null,
        bool $includeTotal = false,
    ): array {
        return $this->runWithRetry(
            fn (CausetHttpConfig $cfg): array => $this->httpClient->runQuery(
                $cfg,
                $querySlug,
                $input,
                $limit,
                $offset,
                $cursor,
                $includeTotal,
            )
        );
    }

    public function listQueries(): array
    {
        return $this->runWithRetry(fn (CausetHttpConfig $cfg): array => $this->httpClient->listQueries($cfg));
    }

    public function getQueryDefinition(string $querySlug): array
    {
        return $this->runWithRetry(
            fn (CausetHttpConfig $cfg): array => $this->httpClient->getQueryDefinition($cfg, $querySlug)
        );
    }

    public function listProjections(): array
    {
        return $this->runWithRetry(fn (CausetHttpConfig $cfg): array => $this->httpClient->listProjections($cfg));
    }

    /**
     * @return array<string, mixed>
     */
    public function listEntities(
        ?string $streamName = null,
        ?string $searchPrefix = null,
        ?string $cursor = null,
        ?int $limit = null,
    ): array {
        return $this->runWithRetry(
            fn (CausetHttpConfig $cfg): array => $this->httpClient->listEntities(
                $cfg,
                $streamName,
                $searchPrefix,
                $cursor,
                $limit,
            )
        );
    }

    /**
     * @return array{state: mixed, cursor: int}
     */
    public function fetchState(string $streamId, string $entityId): array
    {
        return $this->runWithRetry(
            fn (CausetHttpConfig $cfg): array => $this->httpClient->fetchState($cfg, $streamId, $entityId)
        );
    }

    public function select(
        string $streamId,
        string $entityId,
        callable $selector,
        callable $handler,
    ): callable {
        $entry = [
            'streamId' => $streamId,
            'entityId' => $entityId,
            'selector' => $selector,
            'handler' => $handler,
            'lastValue' => null,
        ];

        $state = $this->getState($streamId, $entityId);
        if ($state !== null) {
            $entry['lastValue'] = $selector($state);
            $handler($entry['lastValue']);
        }

        $this->selectors[] = $entry;
        $idx = array_key_last($this->selectors);

        return function () use ($idx): void {
            unset($this->selectors[$idx]);
            $this->selectors = array_values($this->selectors);
        };
    }

    /**
     * @param  array{accepted: bool, execution_id?: string, error?: string, state_patch?: mixed}  $result
     */
    private function refreshSubscriptionAfterIntent(string $streamId, string $entityId, array $result): void
    {
        $key = $this->subKey($streamId, $entityId);
        if (! isset($this->subscriptions[$key])) {
            return;
        }

        $sub = &$this->subscriptions[$key];
        $patch = $result['state_patch'] ?? null;

        if ($patch !== null) {
            $ops = is_string($patch) ? json_decode($patch, true) : $patch;
            if (is_array($ops)) {
                Patch::applyPatch($sub['state'], $ops);
                $this->emitter->emit('patch_op', ['streamId' => $streamId, 'entityId' => $entityId, 'ops' => $ops]);
            }
        } else {
            $fresh = $this->runWithRetry(
                fn (CausetHttpConfig $cfg): array => $this->httpClient->fetchState($cfg, $streamId, $entityId)
            );
            $sub['state'] = is_array($fresh['state']) ? json_decode(json_encode($fresh['state']), true) : [];
            $sub['cursor'] = (int) $fresh['cursor'];
        }

        $this->emitter->emit('state', [
            'streamId' => $streamId,
            'entityId' => $entityId,
            'state' => $this->getState($streamId, $entityId),
        ]);
        $this->notifySelectors($streamId, $entityId);
    }

    private function notifySelectors(string $streamId, string $entityId): void
    {
        $state = $this->getState($streamId, $entityId);
        if ($state === null) {
            return;
        }

        foreach ($this->selectors as $i => $entry) {
            if ($entry['streamId'] !== $streamId || $entry['entityId'] !== $entityId) {
                continue;
            }
            $next = ($entry['selector'])($state);
            if (json_encode($next) !== json_encode($entry['lastValue'])) {
                $this->selectors[$i]['lastValue'] = json_decode(json_encode($next), true);
                ($entry['handler'])($this->selectors[$i]['lastValue']);
            }
        }
    }
}
