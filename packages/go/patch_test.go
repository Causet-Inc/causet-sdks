package causet

import (
	"encoding/json"
	"testing"
)

func TestApplyPatchReplaceAndAdd(t *testing.T) {
	state := map[string]any{"quantity": float64(10), "nested": map[string]any{"a": 1}}
	applyPatch(state, []patchOp{
		{Op: "replace", Path: "/quantity", Value: float64(95)},
		{Op: "add", Path: "/nested/b", Value: 2},
	})
	if state["quantity"] != float64(95) {
		t.Fatalf("quantity = %v", state["quantity"])
	}
	nested := state["nested"].(map[string]any)
	if nested["b"] != 2 {
		t.Fatalf("nested.b = %v", nested["b"])
	}
}

func TestApplyPatchRemove(t *testing.T) {
	state := map[string]any{"a": 1, "b": 2}
	applyPatch(state, []patchOp{{Op: "remove", Path: "/a"}})
	if _, ok := state["a"]; ok {
		t.Fatalf("expected /a removed")
	}
	if state["b"] != 2 {
		t.Fatalf("b should be untouched")
	}
}

func TestApplyPatchIgnoresMalformedPath(t *testing.T) {
	state := map[string]any{"a": 1}
	applyPatch(state, []patchOp{{Op: "replace", Path: "no-leading-slash", Value: 99}})
	if state["a"] != 1 {
		t.Fatalf("state mutated unexpectedly: %#v", state)
	}
}

func TestDecodePatchOpsFromArray(t *testing.T) {
	var raw any
	_ = json.Unmarshal([]byte(`[{"op":"replace","path":"/x","value":5}]`), &raw)
	ops := decodePatchOps(raw)
	if len(ops) != 1 || ops[0].Op != "replace" || ops[0].Path != "/x" {
		t.Fatalf("ops = %#v", ops)
	}
}

func TestDecodePatchOpsFromJSONString(t *testing.T) {
	ops := decodePatchOps(`[{"op":"add","path":"/y","value":"z"}]`)
	if len(ops) != 1 || ops[0].Op != "add" || ops[0].Value != "z" {
		t.Fatalf("ops = %#v", ops)
	}
}

func TestDecodePatchOpsNilAndGarbage(t *testing.T) {
	if ops := decodePatchOps(nil); ops != nil {
		t.Fatalf("expected nil ops, got %#v", ops)
	}
	if ops := decodePatchOps("not json"); ops != nil {
		t.Fatalf("expected nil ops for invalid json, got %#v", ops)
	}
}
