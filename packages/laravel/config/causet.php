<?php

return [
    'api_url' => env('CAUSET_API_URL', 'http://localhost:8085'),
    'platform_slug' => env('CAUSET_PLATFORM', ''),
    'app_slug' => env('CAUSET_APPLICATION', ''),
    'fork_id' => env('CAUSET_FORK', 'main'),
    'api_key' => env('CAUSET_API_KEY'),
    'bearer_token' => env('CAUSET_BEARER_TOKEN'),
    'ws_url' => env('CAUSET_WS_URL'),
    'realtime_url' => env('CAUSET_REALTIME_URL'),
];
