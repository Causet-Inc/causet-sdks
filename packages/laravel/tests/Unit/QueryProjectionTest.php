<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Support\QueryProjection;
use PHPUnit\Framework\TestCase;

class QueryProjectionTest extends TestCase
{
    public function test_flatten_projection_row(): void
    {
        $row = ['artist.name' => 'A', 'venue.name' => 'V', 'id' => 1];
        $flat = QueryProjection::flattenProjectionRow($row);
        $this->assertSame('A', $flat['name']);
        $this->assertSame(1, $flat['id']);
    }

    public function test_flatten_projection_items(): void
    {
        $items = [['a.b' => 1], 'raw'];
        $out = QueryProjection::flattenProjectionItems($items);
        $this->assertSame(1, $out[0]['b']);
        $this->assertSame('raw', $out[1]);
    }

    public function test_stringify_query_input(): void
    {
        $this->assertSame([], QueryProjection::stringifyQueryInput(null));
        $out = QueryProjection::stringifyQueryInput([
            's' => 'x',
            'b' => true,
            'n' => 42,
            'arr' => [1, 2],
            'skip' => null,
        ]);
        $this->assertSame('x', $out['s']);
        $this->assertSame('true', $out['b']);
        $this->assertSame('42', $out['n']);
        $this->assertSame('[1,2]', $out['arr']);
        $this->assertArrayNotHasKey('skip', $out);
    }
}
