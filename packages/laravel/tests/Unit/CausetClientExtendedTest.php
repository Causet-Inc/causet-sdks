<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\CausetClient;
use Causet\Laravel\Exceptions\CausetApiException;
use Causet\Laravel\Http\HttpClient;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class CausetClientExtendedTest extends TestCase
{
    private const BASE = 'https://api.causet.cloud';

    private function makeClient(array $responses, string $apiKey = ''): CausetClient
    {
        $mock = new MockHandler($responses);
        $http = new Client(['handler' => HandlerStack::create($mock)]);

        return new CausetClient(
            new HttpClient($http),
            $http,
            self::BASE,
            'org1',
            'app1',
            apiKey: $apiKey,
            bearerToken: $apiKey === '' ? 'jwt-test' : '',
        );
    }

    public function test_emit_stream(): void
    {
        $sse = "event: START\ndata: {\"ok\":true}\n\n";
        $client = $this->makeClient([
            new Response(200, [], json_encode(['token' => 'jwt-1', 'expiresIn' => 300])),
            new Response(200, ['Content-Type' => 'text/event-stream'], $sse),
        ], apiKey: 'ck_test.secret');

        $events = [];
        $client->init();
        $client->emitStream('s', 'e', 'UPDATE', [], function (array $ev) use (&$events): void {
            $events[] = $ev;
        });
        $this->assertSame('START', $events[0]['event']);
    }

    public function test_connect_stream_emits_stream_event(): void
    {
        $sse = 'data: {"cursor":42,"stream_id":"sku_stream","entity_id":"sku-1","event_type":"STOCK_ADJUSTED"}'."\n\n";
        $client = $this->makeClient([
            new Response(200, ['Content-Type' => 'text/event-stream'], $sse),
        ]);

        $received = [];
        $client->on('stream_event', function (array $ev) use (&$received): void {
            $received[] = $ev;
        });

        $events = [];
        $client->connectStream('sku_stream', function (array $ev) use (&$events): void {
            $events[] = $ev;
        });

        $this->assertCount(1, $events);
        $this->assertSame('STOCK_ADJUSTED', $events[0]['event_type']);
        $this->assertCount(1, $received);
        $this->assertSame('sku_stream', $received[0]['streamId']);
    }

    public function test_401_retry_with_api_key(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode(['token' => 'jwt-old', 'expiresIn' => 300])),
            new Response(401, [], json_encode(['error' => 'expired'])),
            new Response(200, [], json_encode(['token' => 'jwt-new', 'expiresIn' => 300])),
            new Response(200, [], json_encode(['items' => []])),
        ], apiKey: 'ck_test.secret');

        $client->init();
        $rows = $client->runQuery('q');
        $this->assertSame([], $rows['items']);
    }

    public function test_string_state_patch(): void
    {
        $patch = json_encode([['op' => 'replace', 'path' => '/x', 'value' => 3]]);
        $client = $this->makeClient([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1], 'snapshotVersion' => 1])),
            new Response(200, [], json_encode(['accepted' => true, 'statePatch' => $patch])),
        ]);
        $client->subscribe('s', 'e');
        $client->emit('s', 'e', 'UPDATE', []);
        $this->assertSame(['x' => 3], $client->getState('s', 'e'));
    }

    public function test_list_wrappers(): void
    {
        $client = $this->makeClient([
            new Response(200, [], json_encode([['slug' => 'q1']])),
            new Response(200, [], json_encode(['slug' => 'q1'])),
            new Response(200, [], json_encode([['name' => 'p1']])),
            new Response(200, [], json_encode(['entities' => []])),
        ]);
        $this->assertCount(1, $client->listQueries());
        $this->assertSame('q1', $client->getQueryDefinition('q1')['slug']);
        $this->assertCount(1, $client->listProjections());
        $this->assertArrayHasKey('entities', $client->listEntities(streamName: 's'));
    }

    public function test_http_client_guzzle_exception(): void
    {
        $mock = new MockHandler([
            new ConnectException('conn fail', new Request('GET', 'test')),
        ]);
        $http = new HttpClient(new Client(['handler' => HandlerStack::create($mock)]));
        $cfg = new \Causet\Laravel\Http\CausetHttpConfig(self::BASE, 'org1', 'app1', 'main', 'jwt');
        $this->expectException(CausetApiException::class);
        $http->listQueries($cfg);
    }

    public function test_run_query_with_offset(): void
    {
        $mock = new MockHandler([new Response(200, [], json_encode(['items' => []]))]);
        $http = new HttpClient(new Client(['handler' => HandlerStack::create($mock)]));
        $cfg = new \Causet\Laravel\Http\CausetHttpConfig(self::BASE, 'org1', 'app1', 'main', 'jwt');
        $http->runQuery($cfg, 'q', null, offset: 30);
        $this->assertTrue(true);
    }

    public function test_snapshot_string_json_invalid(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['snapshotJson' => '{bad', 'watermark' => 7])),
        ]);
        $http = new HttpClient(new Client(['handler' => HandlerStack::create($mock)]));
        $cfg = new \Causet\Laravel\Http\CausetHttpConfig(self::BASE, 'org1', 'app1', 'main', 'jwt');
        $result = $http->fetchState($cfg, 's', 'e');
        $this->assertSame(7, $result['cursor']);
    }
}
