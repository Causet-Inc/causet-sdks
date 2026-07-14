<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Support\Emitter;
use PHPUnit\Framework\TestCase;

class EmitterTest extends TestCase
{
    public function test_on_emit_and_unsubscribe(): void
    {
        $emitter = new Emitter;
        $calls = [];
        $unsub = $emitter->on('state', function ($d) use (&$calls): void {
            $calls[] = $d;
        });
        $emitter->emit('state', ['x' => 1]);
        $this->assertSame([['x' => 1]], $calls);
        $unsub();
        $emitter->emit('state', ['x' => 2]);
        $this->assertCount(1, $calls);
    }

    public function test_wildcard_handler(): void
    {
        $emitter = new Emitter;
        $seen = [];
        $emitter->on('*', function ($type, $data) use (&$seen): void {
            $seen[] = [$type, $data];
        });
        $emitter->emit('patch', 'p');
        $this->assertSame([['patch', 'p']], $seen);
    }

    public function test_handler_errors_are_swallowed(): void
    {
        $emitter = new Emitter;
        $emitter->on('x', fn () => throw new \RuntimeException('boom'));
        $emitter->emit('x');
        $this->assertTrue(true);
    }
}
