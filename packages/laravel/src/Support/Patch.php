<?php

namespace Causet\Laravel\Support;

class Patch
{
    public static function getPath(mixed $obj, string $path): mixed
    {
        if ($path === '' || ! str_starts_with($path, '/')) {
            return null;
        }

        $current = $obj;
        foreach (explode('/', substr($path, 1)) as $key) {
            if ($key === '') {
                continue;
            }
            if (! is_array($current)) {
                return null;
            }
            if (array_is_list($current)) {
                if (! is_numeric($key)) {
                    return null;
                }
                $current = $current[(int) $key] ?? null;
            } else {
                $current = $current[$key] ?? null;
            }
        }

        return $current;
    }

    public static function setPath(array &$obj, string $path, mixed $value): void
    {
        if ($path === '' || ! str_starts_with($path, '/')) {
            return;
        }

        $keys = explode('/', substr($path, 1));
        $last = array_pop($keys);
        $current = &$obj;

        foreach ($keys as $key) {
            if ($key === '') {
                continue;
            }
            if (! isset($current[$key]) || ! is_array($current[$key]) || array_is_list($current[$key])) {
                $current[$key] = [];
            }
            $current = &$current[$key];
        }

        if ($last !== '') {
            $current[$last] = $value;
        }
    }

    /**
     * @param  array<int, array{op?: string, path?: string, value?: mixed}>|null  $ops
     */
    public static function applyPatch(array &$state, ?array $ops): void
    {
        if (! is_array($ops)) {
            return;
        }

        foreach ($ops as $op) {
            $type = $op['op'] ?? null;
            $path = $op['path'] ?? '';
            if (! str_starts_with($path, '/')) {
                continue;
            }

            if ($type === 'replace' || $type === 'add') {
                self::setPath($state, $path, $op['value'] ?? null);
            } elseif ($type === 'remove') {
                $keys = explode('/', substr($path, 1));
                $last = array_pop($keys);
                $parent = $keys === [] ? $state : self::getPath($state, '/'.implode('/', $keys));
                if (is_array($parent) && ! array_is_list($parent) && $last !== '') {
                    unset($parent[$last]);
                }
            }
        }
    }
}
