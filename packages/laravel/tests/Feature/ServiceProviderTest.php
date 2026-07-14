<?php

namespace Causet\Laravel\Tests\Feature;

use Causet\Laravel\CausetClient;
use Causet\Laravel\Facades\Causet;
use Causet\Laravel\Http\HttpClient;
use Causet\Laravel\Tests\TestCase;

class ServiceProviderTest extends TestCase
{
    public function test_bindings_are_registered(): void
    {
        $this->assertInstanceOf(HttpClient::class, $this->app->make(HttpClient::class));
        $this->assertInstanceOf(CausetClient::class, $this->app->make(CausetClient::class));
    }

    public function test_facade_resolves_client(): void
    {
        $this->assertInstanceOf(CausetClient::class, Causet::getFacadeRoot());
    }

    public function test_config_is_merged(): void
    {
        $this->assertSame('org1', config('causet.platform_slug'));
        $this->assertSame('app1', config('causet.app_slug'));
    }
}
