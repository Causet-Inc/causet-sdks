<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Http\CausetHttpConfig;
use Causet\Laravel\Transport\SseTransport;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class SseTransportTest extends TestCase
{
    public function test_parse_sse_chunk(): void
    {
        $chunk = "event: START\ndata: {\"ok\":true}\n\nid: 1\nevent: COMPLETE\ndata: done\n\npartial";
        $parsed = SseTransport::parseSseChunk($chunk);
        $this->assertCount(2, $parsed['events']);
        $this->assertSame('START', $parsed['events'][0]['event']);
        $this->assertSame(['ok' => true], $parsed['events'][0]['data']);
        $this->assertSame('partial', $parsed['remainder']);
    }

    public function test_parse_sse_chunk_raw_string_data(): void
    {
        $parsed = SseTransport::parseSseChunk("data: not-json\n\n");
        $this->assertSame('not-json', $parsed['events'][0]['data']);
    }

    public function test_build_stream_events_url(): void
    {
        $url = SseTransport::buildStreamEventsUrl(
            'https://sandbox.realtime.causet.cloud',
            'my-platform',
            'my-app',
            'sku_stream:sku-1',
            'sandbox',
            100,
            'jwt-abc',
        );
        $this->assertSame(
            'https://sandbox.realtime.causet.cloud/v1/platforms/my-platform/applications/my-app'
                .'/streams/sku_stream%3Asku-1/events?fork_id=sandbox&from_cursor=100&token=jwt-abc',
            $url,
        );
    }

    public function test_connect_stream_delivers_events(): void
    {
        $body = 'id: 42'."\n"
            .'event: STOCK_ADJUSTED'."\n"
            .'data: {"cursor":42,"stream_id":"sku_stream","entity_id":"sku-1","event_type":"STOCK_ADJUSTED"}'."\n\n";
        $mock = new MockHandler([new Response(200, ['Content-Type' => 'text/event-stream'], $body)]);
        $http = new Client(['handler' => HandlerStack::create($mock)]);

        $events = [];
        SseTransport::connectStream(
            'https://sandbox.realtime.causet.cloud',
            'my-platform',
            'my-app',
            'sku_stream:sku-1',
            'sandbox',
            0,
            'jwt-abc',
            function (array $ev) use (&$events): void {
                $events[] = $ev;
            },
            $http,
        );

        $this->assertCount(1, $events);
        $this->assertSame('STOCK_ADJUSTED', $events[0]['event_type']);
        $this->assertSame(42, $events[0]['cursor']);
    }

    public function test_connect_stream_respects_should_stop(): void
    {
        $body = 'data: {"cursor":1}'."\n\n".'data: {"cursor":2}'."\n\n";
        $mock = new MockHandler([new Response(200, ['Content-Type' => 'text/event-stream'], $body)]);
        $http = new Client(['handler' => HandlerStack::create($mock)]);

        $events = [];
        SseTransport::connectStream(
            'https://sandbox.realtime.causet.cloud',
            'my-platform',
            'my-app',
            'sku_stream',
            'sandbox',
            0,
            'jwt-abc',
            function (array $ev) use (&$events): void {
                $events[] = $ev;
            },
            $http,
            fn (): bool => true,
        );

        $this->assertCount(0, $events);
    }

    public function test_submit_intent_stream(): void
    {
        $body = "event: START\ndata: {\"step\":1}\n\n";
        $mock = new MockHandler([new Response(200, ['Content-Type' => 'text/event-stream'], $body)]);
        $cfg = new CausetHttpConfig('https://api.causet.cloud', 'org1', 'app1', 'main', 'jwt');
        $events = [];
        SseTransport::submitIntentStream(
            $cfg,
            ['forkId' => 'main', 'streamId' => 's', 'entityId' => 'e', 'intentType' => 'X', 'payload' => []],
            function (array $ev) use (&$events): void {
                $events[] = $ev;
            },
            new Client(['handler' => HandlerStack::create($mock)]),
        );
        $this->assertCount(1, $events);
        $this->assertSame('START', $events[0]['event']);
    }
}
