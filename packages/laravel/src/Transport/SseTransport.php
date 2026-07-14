<?php

namespace Causet\Laravel\Transport;

use Causet\Laravel\Http\CausetHttpConfig;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

class SseTransport
{
    /**
     * @return array{events: array<int, array{id: ?string, event: ?string, data: mixed}>, remainder: string}
     */
    public static function parseSseChunk(string $buffer): array
    {
        $events = [];
        $blocks = explode("\n\n", $buffer);
        $remainder = array_pop($blocks) ?? '';

        foreach ($blocks as $block) {
            if (trim($block) === '') {
                continue;
            }

            $eventId = null;
            $eventType = null;
            $dataLines = [];

            foreach (explode("\n", $block) as $line) {
                if (str_starts_with($line, 'id:')) {
                    $eventId = trim(substr($line, 3));
                } elseif (str_starts_with($line, 'event:')) {
                    $eventType = trim(substr($line, 6));
                } elseif (str_starts_with($line, 'data:')) {
                    $dataLines[] = ltrim(substr($line, 5));
                }
            }

            if ($dataLines === []) {
                continue;
            }

            $raw = implode("\n", $dataLines);
            $decoded = json_decode($raw, true);
            $data = json_last_error() === JSON_ERROR_NONE ? $decoded : $raw;

            $events[] = ['id' => $eventId, 'event' => $eventType, 'data' => $data];
        }

        return ['events' => $events, 'remainder' => $remainder];
    }

    /**
     * Canonical stream events URL for causet-realtime:
     * GET {realtimeUrl}/v1/platforms/{platform}/applications/{app}/streams/{streamId}/events
     */
    public static function buildStreamEventsUrl(
        string $realtimeUrl,
        string $platformSlug,
        string $appSlug,
        string $streamId,
        string $forkId,
        int $fromCursor,
        string $token,
    ): string {
        $base = rtrim($realtimeUrl, '/');
        $path = "{$base}/v1/platforms/".rawurlencode($platformSlug)
            .'/applications/'.rawurlencode($appSlug)
            .'/streams/'.rawurlencode($streamId).'/events';

        $query = ['fork_id' => $forkId];
        if ($fromCursor > 0) {
            $query['from_cursor'] = (string) $fromCursor;
        }
        if ($token !== '') {
            $query['token'] = $token;
        }

        return $path.'?'.http_build_query($query);
    }

    /**
     * Consume live ledger/projection events from causet-realtime over SSE.
     * Blocks the calling process for the lifetime of the connection — intended
     * for queue workers, artisan commands, or long-running scripts, not web requests.
     *
     * @param  callable(array<string, mixed>): void  $onEvent
     * @param  (callable(): bool)|null  $shouldStop  Checked between reads; return true to stop the loop
     */
    public static function connectStream(
        string $realtimeUrl,
        string $platformSlug,
        string $appSlug,
        string $streamId,
        string $forkId,
        int $fromCursor,
        string $token,
        callable $onEvent,
        ClientInterface $http,
        ?callable $shouldStop = null,
    ): void {
        $url = self::buildStreamEventsUrl(
            $realtimeUrl,
            $platformSlug,
            $appSlug,
            $streamId,
            $forkId,
            $fromCursor,
            $token,
        );

        $headers = ['Accept' => 'text/event-stream'];
        if ($token !== '') {
            $headers['Authorization'] = 'Bearer '.$token;
        }

        $resp = $http->request('GET', $url, [
            'headers' => $headers,
            'stream' => true,
            'timeout' => 0,
            'http_errors' => true,
        ]);

        $buffer = '';
        $stream = $resp->getBody();
        while (! $stream->eof()) {
            if ($shouldStop !== null && $shouldStop()) {
                return;
            }
            $buffer .= $stream->read(8192);
            $parsed = self::parseSseChunk($buffer);
            $buffer = $parsed['remainder'];
            foreach ($parsed['events'] as $ev) {
                if (is_array($ev['data'])) {
                    $onEvent($ev['data']);
                }
            }
        }

        if ($buffer !== '') {
            $parsed = self::parseSseChunk($buffer."\n\n");
            foreach ($parsed['events'] as $ev) {
                if (is_array($ev['data'])) {
                    $onEvent($ev['data']);
                }
            }
        }
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  callable(array{id: ?string, event: ?string, data: mixed}): void  $onEvent
     */
    public static function submitIntentStream(
        CausetHttpConfig $cfg,
        array $body,
        callable $onEvent,
        ClientInterface $http,
    ): void {
        $url = rtrim($cfg->apiUrl, '/')
            ."/v1/runtime/stream/platforms/{$cfg->platformSlug}/applications/{$cfg->appSlug}/intents/submit";

        $headers = ['Content-Type' => 'application/json', 'Accept' => 'text/event-stream'];
        if ($cfg->bearerToken !== '') {
            $headers['Authorization'] = 'Bearer '.$cfg->bearerToken;
        }

        try {
            $resp = $http->request('POST', $url, [
                'headers' => $headers,
                'json' => $body,
                'stream' => true,
                'timeout' => 120,
                'http_errors' => true,
            ]);
        } catch (GuzzleException $e) {
            throw $e;
        }

        $buffer = '';
        $stream = $resp->getBody();
        while (! $stream->eof()) {
            $buffer .= $stream->read(8192);
            $parsed = self::parseSseChunk($buffer);
            $buffer = $parsed['remainder'];
            foreach ($parsed['events'] as $ev) {
                $onEvent($ev);
            }
        }

        if ($buffer !== '') {
            $parsed = self::parseSseChunk($buffer."\n\n");
            foreach ($parsed['events'] as $ev) {
                $onEvent($ev);
            }
        }
    }
}
