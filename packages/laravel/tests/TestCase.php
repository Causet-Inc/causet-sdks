<?php

namespace Causet\Laravel\Tests;

use Orchestra\Testbench\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function getPackageProviders($app): array
    {
        return [\Causet\Laravel\CausetServiceProvider::class];
    }

    protected function getEnvironmentSetUp($app): void
    {
        $app['config']->set('causet', [
            'api_url' => 'https://api.causet.cloud',
            'platform_slug' => 'org1',
            'app_slug' => 'app1',
            'fork_id' => 'main',
            'api_key' => 'ck_test.secret',
        ]);
    }
}
