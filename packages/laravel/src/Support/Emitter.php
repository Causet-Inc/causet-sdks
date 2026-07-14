<?php

namespace Causet\Laravel\Support;

class Emitter
{
    /** @var array<string, array<int, callable>> */
    private array $handlers = [];

    /** @var array<int, callable> */
    private array $wildcard = [];

    public function on(string $eventType, callable $handler): callable
    {
        if ($eventType === '*') {
            $this->wildcard[] = $handler;

            return function () use ($handler): void {
                $this->wildcard = array_values(array_filter(
                    $this->wildcard,
                    fn (callable $h): bool => $h !== $handler
                ));
            };
        }

        $this->handlers[$eventType] ??= [];
        $this->handlers[$eventType][] = $handler;

        return function () use ($eventType, $handler): void {
            if (! isset($this->handlers[$eventType])) {
                return;
            }
            $this->handlers[$eventType] = array_values(array_filter(
                $this->handlers[$eventType],
                fn (callable $h): bool => $h !== $handler
            ));
        };
    }

    public function emit(string $eventType, mixed $data = null): void
    {
        foreach ($this->handlers[$eventType] ?? [] as $handler) {
            try {
                $handler($data);
            } catch (\Throwable) {
                // handler errors are ignored
            }
        }

        foreach ($this->wildcard as $handler) {
            try {
                $handler($eventType, $data);
            } catch (\Throwable) {
                // handler errors are ignored
            }
        }
    }
}
