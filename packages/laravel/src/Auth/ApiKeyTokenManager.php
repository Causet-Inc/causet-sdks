<?php

namespace Causet\Laravel\Auth;

use Causet\Laravel\Exceptions\CausetAuthException;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

class ApiKeyTokenManager
{
    private const REFRESH_BUFFER_S = 30;
    private const MAX_ATTEMPTS = 4;
    private const RETRY_BASE_MS = 350;

    private ?string $token = null;
    private float $expiresAt = 0;

    /** @var \GuzzleHttp\Promise\PromiseInterface<string>|null */
    private mixed $inflight = null;

    public function __construct(
        private readonly string $apiUrl,
        private readonly string $apiKey,
        private readonly ClientInterface $http,
    ) {
    }

    public function getToken(): string
    {
        $refreshAt = $this->expiresAt - self::REFRESH_BUFFER_S;
        if ($this->token !== null && microtime(true) < $refreshAt) {
            return $this->token;
        }

        return $this->exchange();
    }

    public function init(): void
    {
        $this->getToken();
    }

    public function forceRefresh(): string
    {
        $this->token = null;
        $this->expiresAt = 0;

        return $this->getToken();
    }

    public function destroy(): void
    {
        // no background timers in sync PHP implementation
    }

    private function exchange(): string
    {
        $lastError = null;
        $url = rtrim($this->apiUrl, '/').'/v1/token';

        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            try {
                $resp = $this->http->request('POST', $url, [
                    'headers' => ['Authorization' => 'ApiKey '.$this->apiKey],
                    'timeout' => 120,
                    'http_errors' => false,
                ]);

                if ($resp->getStatusCode() !== 200) {
                    $body = json_decode((string) $resp->getBody(), true) ?? [];
                    $msg = $body['error'] ?? "Token exchange failed: {$resp->getStatusCode()}";
                    throw new CausetAuthException($msg);
                }

                $data = json_decode((string) $resp->getBody(), true) ?? [];
                $token = $data['token'] ?? null;
                if (! is_string($token) || $token === '') {
                    throw new CausetAuthException('Token exchange returned no token');
                }

                $this->token = $token;
                $this->expiresAt = microtime(true) + (float) ($data['expiresIn'] ?? 300);

                return $this->token;
            } catch (CausetAuthException $e) {
                throw $e;
            } catch (GuzzleException $e) {
                $lastError = $e;
                if ($attempt + 1 >= self::MAX_ATTEMPTS) {
                    break;
                }
                usleep(self::RETRY_BASE_MS * (2 ** $attempt) * 1000);
            }
        }

        $msg = $lastError instanceof \Throwable ? $lastError->getMessage() : 'unknown error';
        throw new CausetAuthException("Causet auth unreachable: {$msg}");
    }

    public static function orgIdFromToken(string $token): ?string
    {
        $parts = explode('.', $token);
        if (count($parts) < 2) {
            return null;
        }

        $payload = strtr($parts[1], '-_', '+/');
        $pad = 4 - (strlen($payload) % 4);
        if ($pad !== 4) {
            $payload .= str_repeat('=', $pad);
        }

        $decoded = base64_decode($payload, true);
        if ($decoded === false) {
            return null;
        }

        $json = json_decode($decoded, true);

        return is_array($json) ? ($json['org_id'] ?? null) : null;
    }

    public static function deriveRealtimeUrl(string $apiUrl): string
    {
        $u = rtrim($apiUrl, '/');
        $map = [
            'sandbox.api.causet.cloud' => 'sandbox.realtime.causet.cloud',
            'api.causet.cloud' => 'realtime.causet.cloud',
        ];
        $parts = parse_url($u);
        if (! is_array($parts) || ! isset($parts['host'])) {
            return $u;
        }
        $host = $parts['host'];
        if (isset($map[$host])) {
            $parts['host'] = $map[$host];

            return self::buildOrigin($parts);
        }
        if ($host === 'localhost' || $host === '127.0.0.1') {
            $port = $parts['port'] ?? 8081;
            if ($port === 8085) {
                $port = 8081;
            }
            $parts['port'] = $port;

            return self::buildOrigin($parts);
        }
        if (str_contains($host, '.api.')) {
            $parts['host'] = str_replace('.api.', '.realtime.', $host);

            return self::buildOrigin($parts);
        }

        return $u;
    }

    public static function deriveWsUrl(string $apiUrl): string
    {
        return self::deriveWsUrlFromRealtime(self::deriveRealtimeUrl($apiUrl));
    }

    public static function deriveWsUrlFromRealtime(string $realtimeUrl): string
    {
        $u = rtrim($realtimeUrl, '/');
        if (str_starts_with($u, 'https://')) {
            return str_replace('https://', 'wss://', $u).'/ws';
        }
        if (str_starts_with($u, 'http://')) {
            return str_replace('http://', 'ws://', $u).'/ws';
        }

        return $u.'/ws';
    }

    private static function buildOrigin(array $parts): string
    {
        $scheme = $parts['scheme'] ?? 'https';
        $host = $parts['host'] ?? '';
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';

        return $scheme.'://'.$host.$port;
    }
}
