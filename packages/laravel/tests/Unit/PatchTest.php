<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Support\Patch;
use PHPUnit\Framework\TestCase;

class PatchTest extends TestCase
{
    public function test_get_path_nested(): void
    {
        $obj = ['a' => ['b' => 1], 'items' => [10, 20]];
        $this->assertSame(1, Patch::getPath($obj, '/a/b'));
        $this->assertSame(20, Patch::getPath($obj, '/items/1'));
        $this->assertNull(Patch::getPath($obj, '/missing'));
        $this->assertNull(Patch::getPath($obj, 'bad'));
        $this->assertNull(Patch::getPath($obj, '/items/x'));
    }

    public function test_set_path_creates_intermediates(): void
    {
        $obj = [];
        Patch::setPath($obj, '/a/b', 99);
        $this->assertSame(['a' => ['b' => 99]], $obj);
    }

    public function test_apply_patch_replace_add_remove(): void
    {
        $state = ['x' => 1, 'y' => ['z' => 2]];
        Patch::applyPatch($state, [
            ['op' => 'replace', 'path' => '/x', 'value' => 5],
            ['op' => 'add', 'path' => '/new', 'value' => 'v'],
            ['op' => 'remove', 'path' => '/y/z'],
        ]);
        $this->assertSame(5, $state['x']);
        $this->assertSame('v', $state['new']);
        $this->assertSame([], $state['y']);
    }

    public function test_apply_patch_ignores_invalid(): void
    {
        $state = ['x' => 1];
        Patch::applyPatch($state, null);
        Patch::applyPatch($state, [['op' => 'replace', 'path' => 'no-slash', 'value' => 9]]);
        $this->assertSame(['x' => 1], $state);
    }
}
