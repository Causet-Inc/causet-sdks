package causet

import (
	"encoding/json"
	"strings"
)

// getPath reads a JSON-Patch-style "/a/b/0" path from a decoded JSON value
// (map[string]any / []any tree, as produced by encoding/json).
func getPath(obj any, path string) any {
	if !strings.HasPrefix(path, "/") {
		return nil
	}
	current := obj
	for _, key := range strings.Split(path[1:], "/") {
		switch v := current.(type) {
		case map[string]any:
			current = v[key]
		case []any:
			idx, err := parseIndex(key)
			if err != nil || idx < 0 || idx >= len(v) {
				return nil
			}
			current = v[idx]
		default:
			return nil
		}
	}
	return current
}

// setPath writes value at a JSON-Patch-style path, creating intermediate
// objects as needed (mirrors the TS/Python setPath/set_path helpers).
func setPath(state map[string]any, path string, value any) {
	if !strings.HasPrefix(path, "/") {
		return
	}
	keys := strings.Split(path[1:], "/")
	last := keys[len(keys)-1]
	keys = keys[:len(keys)-1]

	current := state
	for _, key := range keys {
		child, ok := current[key].(map[string]any)
		if !ok {
			child = map[string]any{}
			current[key] = child
		}
		current = child
	}
	current[last] = value
}

func removePath(state map[string]any, path string) {
	if !strings.HasPrefix(path, "/") {
		return
	}
	keys := strings.Split(path[1:], "/")
	last := keys[len(keys)-1]
	parentPath := "/" + strings.Join(keys[:len(keys)-1], "/")

	var parent map[string]any
	if len(keys) == 1 {
		parent = state
	} else {
		if p, ok := getPath(state, parentPath).(map[string]any); ok {
			parent = p
		}
	}
	if parent != nil {
		delete(parent, last)
	}
}

func parseIndex(s string) (int, error) {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, &Error{Message: "invalid array index: " + s}
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

// patchOp mirrors a single RFC 6902 operation as delivered by causet-realtime
// (op/path/value fields; add and replace are handled identically).
type patchOp struct {
	Op    string `json:"op"`
	Path  string `json:"path"`
	Value any    `json:"value"`
}

// applyPatch mutates state in place per a list of decoded patch operations.
// Unknown ops and malformed paths are ignored (matches TS applyPatch /
// Python apply_patch, which are best-effort for display/cache purposes).
func applyPatch(state map[string]any, ops []patchOp) {
	for _, op := range ops {
		if !strings.HasPrefix(op.Path, "/") {
			continue
		}
		switch op.Op {
		case "replace", "add":
			setPath(state, op.Path, op.Value)
		case "remove":
			removePath(state, op.Path)
		}
	}
}

// decodePatchOps converts the loosely-typed patch value returned by the
// runtime/realtime services into []patchOp. The runtime's statePatch may
// arrive as a JSON-encoded string (intent submit response) or an already
// decoded []any (realtime stream events); both are handled here.
func decodePatchOps(raw any) []patchOp {
	if s, ok := raw.(string); ok {
		var decoded any
		if json.Unmarshal([]byte(s), &decoded) != nil {
			return nil
		}
		raw = decoded
	}
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	ops := make([]patchOp, 0, len(list))
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		op := patchOp{}
		if s, ok := m["op"].(string); ok {
			op.Op = s
		}
		if s, ok := m["path"].(string); ok {
			op.Path = s
		}
		op.Value = m["value"]
		ops = append(ops, op)
	}
	return ops
}
