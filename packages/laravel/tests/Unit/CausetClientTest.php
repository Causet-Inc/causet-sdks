<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\CausetClient;
use Causet\Laravel\Exceptions\CausetException;
use Causet\Laravel\Http\HttpClient;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class CausetClientTest extends TestCase
{
    private const BASE = 'https://api.causet.cloud';
    private const PREFIX = self::BASE.'/v1/platforms/org1/applications/app1';
    private const RUNTIME = self::BASE.'/v1/runtime/platforms/org1/applications/app1';

    private function makeClient(array $responses, string $bearer = 'jwt-test'): CausetClient
    {
        $mock = new MockHandler($responses);
        $http = new Client(['handler' => HandlerStack::create($mock)]);

        return new CausetClient(
            new HttpClient($http),
            $http,
            self::BASE,
            'org1',
            'app1',
            bearerToken: $bearer,
        );
    }

    public function test_subscribe_and_intent_with_patch(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1], 'snapshotVersion' => 1])),
            new Response(200, [], json_encode([
                'accepted' => true,
                'statePatch' => [['op' => 'replace', 'path' => '/x', 'value' => 2]],
            ])),
        ]);
        $client->subscribe('s', 'e');
        $this->assertSame(['x' => 1], $client->getState('s', 'e'));
        $result = $client->intent('s', 'e', 'UPDATE', ['x' => 2]);
        $this->assertTrue($result['accepted']);
        $this->assertSame(['x' => 2], $client->getState('s', 'e'));
    }

    public function test_intent_refetches_without_patch(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1], 'snapshotVersion' => 1])),
            new Response(200, [], json_encode(['accepted' => true])),
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 99], 'snapshotVersion' => 2])),
        ]);
        $client->subscribe('s', 'e');
        $client->intent('s', 'e', 'UPDATE', []);
        $this->assertSame(['x' => 99], $client->getState('s', 'e'));
    }

    public function test_run_query(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['items' => [['a.b' => 1]]])),
        ]);
        $rows = $client->runQuery('q', ['x' => 1], limit: 10);
        $this->assertSame(1, $rows['items'][0]['b']);
    }

    public function test_select_fires_on_change(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1, 'y' => 10], 'snapshotVersion' => 1])),
            new Response(200, [], json_encode([
                'accepted' => true,
                'statePatch' => [['op' => 'replace', 'path' => '/x', 'value' => 2]],
            ])),
        ]);
        $client->subscribe('s', 'e');
        $seen = [];
        $unsub = $client->select('s', 'e', fn (array $st) => $st['x'], function ($v) use (&$seen): void {
            $seen[] = $v;
        });
        $this->assertSame([1], $seen);
        $client->intent('s', 'e', 'UPDATE', ['x' => 2]);
        $this->assertSame([1, 2], $seen);
        $unsub();
    }

    public function test_on_event_handler(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1], 'snapshotVersion' => 1])),
        ]);
        $states = [];
        $client->on('state', function ($ev) use (&$states): void {
            $states[] = $ev;
        });
        $client->subscribe('s', 'e');
        $this->assertCount(1, $states);
    }

    public function test_get_token_public_throws_without_credentials(): void
    {
        $http = new Client(['handler' => HandlerStack::create(new MockHandler([]))]);
        $client = new CausetClient(new HttpClient($http), $http, self::BASE, 'org1', 'app1');
        $this->expectException(CausetException::class);
        $client->getTokenPublic();
    }

    public function test_unsubscribe(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1], 'snapshotVersion' => 1])),
        ]);
        $client->subscribe('s', 'e');
        $client->unsubscribe('s', 'e');
        $this->assertNull($client->getState('s', 'e'));
    }

    public function test_fetch_state(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 5], 'snapshotVersion' => 1])),
        ]);
        $result = $client->fetchState('s', 'e');
        $this->assertSame(['x' => 5], $result['state']);
    }

    public function test_init_destroy(): void
    {
        $client = $this->makeClient([]);
        $client->init();
        $client->destroy();
        $this->assertTrue(true);
    }
}
