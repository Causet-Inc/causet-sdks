package causet

import (
	"encoding/json"
	"fmt"
)

// stringifyQueryInput coerces input values to strings for POST
// .../queries/{slug}/run, which expects Map<String, String> (mirrors
// stringifyQueryInput in the TS/Python SDKs). Strings pass through as-is;
// booleans become "true"/"false"; everything else (numbers, lists, maps) is
// JSON-encoded, e.g. ["Pop","Rock"] for a slice.
func stringifyQueryInput(raw map[string]any) map[string]string {
	out := map[string]string{}
	for k, v := range raw {
		if v == nil {
			continue
		}
		switch val := v.(type) {
		case string:
			out[k] = val
		case bool:
			if val {
				out[k] = "true"
			} else {
				out[k] = "false"
			}
		default:
			if b, err := json.Marshal(val); err == nil {
				out[k] = string(b)
			} else {
				out[k] = fmt.Sprintf("%v", val)
			}
		}
	}
	return out
}

// flattenProjectionRow collapses dotted/qualified column names (e.g.
// "orders.status") down to their short form, keeping the last value seen —
// mirrors flattenProjectionRow in the TS/Python SDKs.
func flattenProjectionRow(row map[string]any) map[string]any {
	out := make(map[string]any, len(row))
	for k, v := range row {
		short := k
		for i := len(k) - 1; i >= 0; i-- {
			if k[i] == '.' {
				short = k[i+1:]
				break
			}
		}
		out[short] = v
	}
	return out
}

func flattenProjectionItems(items []any) []any {
	out := make([]any, len(items))
	for i, item := range items {
		if row, ok := item.(map[string]any); ok {
			out[i] = flattenProjectionRow(row)
		} else {
			out[i] = item
		}
	}
	return out
}
