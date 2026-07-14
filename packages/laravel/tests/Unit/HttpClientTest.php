<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Exceptions\CausetApiException;
use Causet\Laravel\Http\CausetHttpConfig;
use Causet\Laravel\Http\HttpClient;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class HttpClientTest extends TestCase
{
    private const BASE = 'https://api.causet.cloud';
    private const PREFIX = self::BASE.'/v1/platforms/org1/applications/app1';
    private const RUNTIME = self::BASE.'/v1/runtime/platforms/org1/applications/app1';

    private function client(MockHandler $mock): HttpClient
    {
        return new HttpClient(new Client(['handler' => HandlerStack::create($mock)]));
    }

    private function cfg(): CausetHttpConfig
    {
        return new CausetHttpConfig(self::BASE, 'org1', 'app1', 'main', 'jwt-test');
    }

    public function test_fetch_state_parses_snapshot(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['snapshotJson' => ['x' => 1], 'snapshotVersion' => 3])),
        ]);
        $result = $this->client($mock)->fetchState($this->cfg(), 's', 'e');
        $this->assertSame(['x' => 1], $result['state']);
        $this->assertSame(3, $result['cursor']);
    }

    public function test_fetch_state_404(): void
    {
        $mock = new MockHandler([new Response(404)]);
        $result = $this->client($mock)->fetchState($this->cfg(), 's', 'e');
        $this->assertNull($result['state']);
        $this->assertSame(0, $result['cursor']);
    }

    public function test_emit_intent(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode([
                'accepted' => true,
                'executionId' => 'exec-1',
                'statePatch' => [['op' => 'replace', 'path' => '/x', 'value' => 2]],
            ])),
        ]);
        $result = $this->client($mock)->emitIntent($this->cfg(), 's', 'e', 'UPDATE', ['x' => 2]);
        $this->assertTrue($result['accepted']);
        $this->assertSame('exec-1', $result['execution_id']);
    }

    public function test_run_query_flattens_items(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['items' => [['a.b' => 1]]])),
        ]);
        $result = $this->client($mock)->runQuery($this->cfg(), 'q', ['x' => 1], limit: 10);
        $this->assertSame(1, $result['items'][0]['b']);
    }

    public function test_run_query_with_cursor_and_include_total(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode(['items' => [], 'total_count' => 0])),
        ]);
        $result = $this->client($mock)->runQuery(
            $this->cfg(),
            'q',
            null,
            cursor: 'abc',
            includeTotal: true,
        );
        $this->assertSame(0, $result['total_count']);
    }

    public function test_list_endpoints(): void
    {
        $mock = new MockHandler([
            new Response(200, [], json_encode([['slug' => 'q1']])),
            new Response(200, [], json_encode(['slug' => 'q1'])),
            new Response(200, [], json_encode([['name' => 'p1']])),
            new Response(200, [], json_encode(['entities' => []])),
        ]);
        $http = $this->client($mock);
        $cfg = $this->cfg();
        $this->assertCount(1, $http->listQueries($cfg));
        $this->assertSame('q1', $http->getQueryDefinition($cfg, 'q1')['slug']);
        $this->assertCount(1, $http->listProjections($cfg));
        $this->assertArrayHasKey('entities', $http->listEntities($cfg, streamName: 's', limit: 5));
    }

    public function test_api_error(): void
    {
        $mock = new MockHandler([new Response(500, [], json_encode(['error' => 'boom']))]);
        $this->expectException(CausetApiException::class);
        $this->client($mock)->listQueries($this->cfg());
    }

    public function test_invalid_json_response(): void
    {
        $mock = new MockHandler([new Response(200, [], 'not-json')]);
        $this->expectException(CausetApiException::class);
        $this->client($mock)->listQueries($this->cfg());
    }

    public function test_empty_response_body(): void
    {
        $mock = new MockHandler([new Response(200, [], '')]);
        $result = $this->client($mock)->listQueries($this->cfg());
        $this->assertSame([], $result);
    }

    public function test_config_urls(): void
    {
        $cfg = $this->cfg();
        $this->assertStringContainsString('/v1/platforms/', $cfg->base());
        $this->assertStringContainsString('/v1/runtime/', $cfg->runtimeBase());
    }
}
