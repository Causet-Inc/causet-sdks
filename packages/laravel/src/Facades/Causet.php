<?php

namespace Causet\Laravel\Facades;

use Illuminate\Support\Facades\Facade;

/**
 * @method static void init()
 * @method static void destroy()
 * @method static callable on(string $eventType, callable $handler)
 * @method static void subscribe(string $streamId, string $entityId)
 * @method static void unsubscribe(string $streamId, string $entityId)
 * @method static array|null getState(string $streamId, string $entityId)
 * @method static array emit(string $streamId, string $entityId, string $intentType, array $payload, ?string $intentId = null)
 * @method static void emitStream(string $streamId, string $entityId, string $intentType, array $payload, callable $onEvent, ?string $intentId = null)
 * @method static void connectStream(string $streamId, callable $onEvent, ?string $forkId = null, int $fromCursor = 0, ?callable $shouldStop = null)
 * @method static void disconnectStream()
 * @method static array runQuery(string $querySlug, ?array $input = null, ?int $limit = null, ?int $offset = null, ?string $cursor = null, bool $includeTotal = false)
 * @method static array listQueries()
 * @method static array getQueryDefinition(string $querySlug)
 * @method static array listProjections()
 * @method static array listEntities(?string $streamName = null, ?string $searchPrefix = null, ?string $cursor = null, ?int $limit = null)
 * @method static array fetchState(string $streamId, string $entityId)
 * @method static callable select(string $streamId, string $entityId, callable $selector, callable $handler)
 * @method static string getTokenPublic()
 *
 * @see \Causet\Laravel\CausetClient
 */
class Causet extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return CausetClient::class;
    }
}
