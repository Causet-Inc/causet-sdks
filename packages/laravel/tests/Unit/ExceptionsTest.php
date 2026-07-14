<?php

namespace Causet\Laravel\Tests\Unit;

use Causet\Laravel\Exceptions\CausetApiException;
use Causet\Laravel\Exceptions\CausetAuthException;
use Causet\Laravel\Exceptions\CausetException;
use PHPUnit\Framework\TestCase;

class ExceptionsTest extends TestCase
{
    public function test_causet_exception(): void
    {
        $e = new CausetException('fail');
        $this->assertSame('fail', $e->getMessage());
    }

    public function test_causet_auth_exception(): void
    {
        $e = new CausetAuthException('auth');
        $this->assertInstanceOf(CausetException::class, $e);
    }

    public function test_causet_api_exception(): void
    {
        $e = new CausetApiException(403, 'denied', ['error' => 'denied']);
        $this->assertSame(403, $e->statusCode);
        $this->assertSame('[403] denied', $e->getMessage());
        $this->assertSame(['error' => 'denied'], $e->body);
    }
}
