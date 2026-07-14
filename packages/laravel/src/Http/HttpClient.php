<?php

namespace Causet\Laravel\Http;

use Causet\Laravel\Exceptions\CausetApiException;
use Causet\Laravel\Support\QueryProjection;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;
use Psr\Http\Message\ResponseInterface;

class HttpClient
{
    private const TIMEOUT = 120;

    public function __construct(
        private readonly ClientInterface $http,
    ) {
    }

    /**
     * @param  array<string, string>  $params
     */
    private function request(
        CausetHttpConfig $cfg,
        string $method,
        string $url,
        ?array $json = null,
        array $params = [],
        bool $allow404 = false,
    ): mixed {
        $options = [
            'headers' => $this->headers($cfg),
            'timeout' => self::TIMEOUT,
            'http_errors' => false,
        ];
        if ($json !== null) {
            $options['json'] = $json;
        }
        if ($params !== []) {
            $options['query'] = $params;
        }

        try {
            $resp = $this->http->request($method, $url, $options);
        } catch (GuzzleException $e) {
            throw new CausetApiException(0, $e->getMessage());
        }

        $status = $resp->getStatusCode();
        if ($allow404 && $status === 404) {
            return null;
        }

        if ($status < 200 || $status >= 300) {
            $body = $this->decodeBody($resp);
            $msg = is_array($body)
                ? ($body['error'] ?? $body['message'] ?? 'Request failed')
                : 'Request failed';
            throw new CausetApiException($status, (string) $msg, $body);
        }

        $text = trim((string) $resp->getBody());
        if ($text === '') {
            return [];
        }

        $parsed = json_decode($text, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new CausetApiException($status, 'Invalid JSON in response', ['raw' => substr($text, 0, 2000)]);
        }

        return $parsed;
    }

    /**
     * @return array<string, string>
     */
    private function headers(CausetHttpConfig $cfg): array
    {
        $h = ['Content-Type' => 'application/json'];
        if ($cfg->bearerToken !== '') {
            $h['Authorization'] = 'Bearer '.$cfg->bearerToken;
        }

        return $h;
    }

    private function decodeBody(ResponseInterface $resp): mixed
    {
        $text = trim((string) $resp->getBody());
        if ($text === '') {
            return [];
        }

        return json_decode($text, true) ?? [];
    }

    /**
     * @return array{state: mixed, cursor: int}
     */
    private function parseSnapshot(array $data): array
    {
        $state = $data;
        $raw = $data['snapshotJson'] ?? null;
        if ($raw !== null) {
            if (is_string($raw)) {
                $decoded = json_decode($raw, true);
                $state = json_last_error() === JSON_ERROR_NONE ? $decoded : $data;
            } else {
                $state = $raw;
            }
        }

        $cursor = $data['snapshotVersion'] ?? $data['watermark'] ?? 0;

        return ['state' => $state, 'cursor' => (int) $cursor];
    }

    /**
     * @return array{state: mixed, cursor: int}
     */
    public function fetchState(CausetHttpConfig $cfg, string $streamId, string $entityId): array
    {
        $url = "{$cfg->base()}/entities/{$streamId}/{$entityId}/state";
        $data = $this->request($cfg, 'GET', $url, null, ['forkId' => $cfg->forkId], true);
        if ($data === null) {
            return ['state' => null, 'cursor' => 0];
        }

        return $this->parseSnapshot($data);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{accepted: bool, execution_id?: string, error?: string, state_patch?: mixed}
     */
    public function emitIntent(
        CausetHttpConfig $cfg,
        string $streamId,
        string $entityId,
        string $intentType,
        array $payload,
        ?string $intentId = null,
    ): array {
        $url = "{$cfg->runtimeBase()}/intents/submit";
        $body = [
            'forkId' => $cfg->forkId,
            'streamId' => $streamId,
            'entityId' => $entityId,
            'intentType' => $intentType,
            'payload' => $payload,
        ];
        if ($intentId !== null) {
            $body['intentId'] = $intentId;
        }

        $data = $this->request($cfg, 'POST', $url, $body);

        return [
            'accepted' => (bool) ($data['accepted'] ?? false),
            'execution_id' => $data['executionId'] ?? null,
            'error' => $data['error'] ?? null,
            'state_patch' => $data['statePatch'] ?? null,
        ];
    }

    /**
     * @param  array<string, mixed>|null  $input
     * @return array<string, mixed>
     */
    public function runQuery(
        CausetHttpConfig $cfg,
        string $querySlug,
        ?array $input = null,
        ?int $limit = null,
        ?int $offset = null,
        ?string $cursor = null,
        bool $includeTotal = false,
    ): array {
        $url = "{$cfg->base()}/forks/{$cfg->forkId}/queries/".rawurlencode($querySlug).'/run';
        $body = ['input' => QueryProjection::stringifyQueryInput($input)];
        if ($limit !== null) {
            $body['limit'] = $limit;
        }
        if ($cursor !== null) {
            $body['cursor'] = $cursor;
        } elseif ($offset !== null && $offset > 0) {
            $body['offset'] = $offset;
        }
        if ($includeTotal) {
            $body['include_total'] = true;
        }

        $data = $this->request($cfg, 'POST', $url, $body);
        if (isset($data['items']) && is_array($data['items'])) {
            $data['items'] = QueryProjection::flattenProjectionItems($data['items']);
        }

        return $data;
    }

    public function listQueries(CausetHttpConfig $cfg): array
    {
        $url = "{$cfg->base()}/forks/{$cfg->forkId}/queries/";

        return $this->request($cfg, 'GET', $url) ?? [];
    }

    public function getQueryDefinition(CausetHttpConfig $cfg, string $querySlug): array
    {
        $url = "{$cfg->base()}/forks/{$cfg->forkId}/queries/".rawurlencode($querySlug);

        return $this->request($cfg, 'GET', $url) ?? [];
    }

    public function listProjections(CausetHttpConfig $cfg): array
    {
        $url = "{$cfg->base()}/forks/{$cfg->forkId}/projections";

        return $this->request($cfg, 'GET', $url) ?? [];
    }

    /**
     * @return array<string, mixed>
     */
    public function listEntities(
        CausetHttpConfig $cfg,
        ?string $streamName = null,
        ?string $searchPrefix = null,
        ?string $cursor = null,
        ?int $limit = null,
    ): array {
        $url = "{$cfg->base()}/entities";
        $params = ['forkId' => $cfg->forkId];
        if ($streamName !== null) {
            $params['streamName'] = $streamName;
        }
        if ($searchPrefix !== null) {
            $params['searchPrefix'] = $searchPrefix;
        }
        if ($cursor !== null) {
            $params['cursor'] = $cursor;
        }
        if ($limit !== null) {
            $params['limit'] = (string) $limit;
        }

        return $this->request($cfg, 'GET', $url, null, $params) ?? [];
    }
}
