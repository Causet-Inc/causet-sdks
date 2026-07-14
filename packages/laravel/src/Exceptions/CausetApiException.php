<?php

namespace Causet\Laravel\Exceptions;

class CausetApiException extends CausetException
{
    public function __construct(
        public readonly int $statusCode,
        string $message,
        public readonly mixed $body = null,
    ) {
        parent::__construct("[{$statusCode}] {$message}");
    }
}
