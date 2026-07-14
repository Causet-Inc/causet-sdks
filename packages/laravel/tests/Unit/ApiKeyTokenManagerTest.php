<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Auth\ApiKeyTokenManager;
use Causet\Laravel\Exceptions\CausetAuthException;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class ApiKeyTokenManagerTest extends TestCase
{
    public function test_exchange_and_cache(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['token' => 'jwt-1', 'expiresIn' => 300])),
        ]);
        $mgr = new ApiKeyTokenManager(
            'https://api.causet.cloud',
            'ck_test.secret',
            new Client(['handler' => HandlerStack::create($mock)]),
        );
        $this->assertSame('jwt-1', $mgr->getToken());
        $this->assertSame('jwt-1', $mgr->getToken());
    }

    public function test_force_refresh(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['token' => 'jwt-1', 'expiresIn' => 300])),
            new Response(200, [], json_encode(['token' => 'jwt-2', 'expiresIn' => 300])),
        ]);
        $mgr = new ApiKeyTokenManager(
            'https://api.causet.cloud',
            'ck_test.secret',
            new Client(['handler' => HandlerStack::create($mock)]),
        );
        $this->assertSame('jwt-1', $mgr->getToken());
        $this->assertSame('jwt-2', $mgr->forceRefresh());
    }

    public function test_exchange_failure(): void
    {
        $mock = new MockHandler([new Response(401, [], json_encode(['error' => 'bad key']))]);
        $mgr = new ApiKeyTokenManager(
            'https://api.causet.cloud',
            'bad',
            new Client(['handler' => HandlerStack::create($mock)]),
        );
        $this->expectException(CausetAuthException::class);
        $mgr->getToken();
    }

    public function test_no_token_in_response(): void
    {
        $mock = new MockHandler([new Response(200, [], json_encode(['expiresIn' => 300]))]);
        $mgr = new ApiKeyTokenManager(
            'https://api.causet.cloud',
            'ck_test.secret',
            new Client(['handler' => HandlerStack::create($mock)]),
        );
        $this->expectException(CausetAuthException::class);
        $mgr->getToken();
    }

    public function test_derive_ws_url(): void
    {
        $this->assertSame('wss://api.example.com/ws', ApiKeyTokenManager::deriveWsUrl('https://api.example.com'));
        $this->assertSame('ws://localhost:8081/ws', ApiKeyTokenManager::deriveWsUrl('http://localhost:8085'));
        $this->assertSame(
            'wss://sandbox.realtime.causet.cloud/ws',
            ApiKeyTokenManager::deriveWsUrl('https://sandbox.api.causet.cloud'),
        );
        $this->assertSame('custom/ws', ApiKeyTokenManager::deriveWsUrl('custom'));
    }

    public function test_org_id_from_token(): void
    {
        $payload = base64_encode(json_encode(['org_id' => 'org-123']));
        $token = "header.{$payload}.sig";
        $this->assertSame('org-123', ApiKeyTokenManager::orgIdFromToken($token));
        $this->assertNull(ApiKeyTokenManager::orgIdFromToken('bad'));
    }

    public function test_init_and_destroy(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['token' => 'jwt-1', 'expiresIn' => 300])),
        ]);
        $mgr = new ApiKeyTokenManager(
            'https://api.causet.cloud',
            'ck_test.secret',
            new Client(['handler' => HandlerStack::create($mock)]),
        );
        $mgr->init();
        $mgr->destroy();
        $this->assertTrue(true);
    }
}
