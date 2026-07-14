<?php

namespace Causet\Laravel\Http;

class CausetHttpConfig
{
    public function __construct(
        public readonly string $apiUrl,
        public readonly string $platformSlug,
        public readonly string $appSlug,
        public readonly string $forkId = 'main',
        public readonly string $bearerToken = '',
    ) {
    }

    public function base(): string
    {
        return rtrim($this->apiUrl, '/')."/v1/platforms/{$this->platformSlug}/applications/{$this->appSlug}";
    }

    public function runtimeBase(): string
    {
        return rtrim($this->apiUrl, '/')."/v1/runtime/platforms/{$this->platformSlug}/applications/{$this->appSlug}";
    }
}
