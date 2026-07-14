<?php

namespace Causet\Laravel;

use Causet\Laravel\Http\HttpClient;
use GuzzleHttp\Client;
use Illuminate\Support\ServiceProvider;

class CausetServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/causet.php', 'causet');

        $this->app->singleton(HttpClient::class, function (): HttpClient {
            return new HttpClient(new Client);
        });

        $this->app->singleton(CausetClient::class, function ($app): CausetClient {
            $cfg = $app['config']->get('causet', []);

            return new CausetClient(
                $app->make(HttpClient::class),
                new Client,
                (string) ($cfg['api_url'] ?? 'http://localhost:8085'),
                (string) ($cfg['platform_slug'] ?? ''),
                (string) ($cfg['app_slug'] ?? ''),
                (string) ($cfg['fork_id'] ?? 'main'),
                $cfg['ws_url'] ?? null,
                (string) ($cfg['bearer_token'] ?? ''),
                (string) ($cfg['api_key'] ?? ''),
                $cfg['realtime_url'] ?? null,
            );
        });
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__.'/../config/causet.php' => config_path('causet.php'),
            ], 'causet-config');
        }
    }
}
