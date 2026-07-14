<?php

namespace Causet\Laravel\Support;

class QueryProjection
{
    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public static function flattenProjectionRow(array $row): array
    {
        $out = [];
        $byShort = [];

        foreach ($row as $k => $v) {
            if (! is_string($k)) {
                $out[$k] = $v;
                continue;
            }
            $short = str_contains($k, '.') ? substr($k, strrpos($k, '.') + 1) : $k;
            $byShort[$short][] = [$k, $v];
        }

        foreach ($byShort as $short => $pairs) {
            $out[$short] = $pairs[count($pairs) - 1][1];
        }

        return $out;
    }

    /**
     * @param  array<int, mixed>  $items
     * @return array<int, mixed>
     */
    public static function flattenProjectionItems(array $items): array
    {
        return array_map(
            fn (mixed $r): mixed => is_array($r) && ! array_is_list($r)
                ? self::flattenProjectionRow($r)
                : $r,
            $items
        );
    }

    /**
     * @param  array<string, mixed>|null  $raw
     * @return array<string, string>
     */
    public static function stringifyQueryInput(?array $raw): array
    {
        if ($raw === null || $raw === []) {
            return [];
        }

        $out = [];
        foreach ($raw as $k => $v) {
            if ($v === null) {
                continue;
            }
            if (is_string($v)) {
                $out[$k] = $v;
            } elseif (is_bool($v)) {
                $out[$k] = $v ? 'true' : 'false';
            } elseif (is_int($v) || is_float($v)) {
                $out[$k] = (string) $v;
            } elseif (is_array($v)) {
                $out[$k] = json_encode($v, JSON_UNESCAPED_SLASHES);
            } else {
                $out[$k] = (string) $v;
            }
        }

        return $out;
    }
}
