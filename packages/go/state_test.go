package causet

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return NewClient(Config{
		APIURL:       srv.URL,
		PlatformSlug: "plat",
		AppSlug:      "app",
		ForkID:       "sandbox",
		BearerToken:  "test-token",
	})
}

func TestSubscribeGetStateUnsubscribe(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/state") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"snapshotJson":    map[string]any{"quantity": 10},
				"snapshotVersion": 3,
			})
			return
		}
		http.NotFound(w, r)
	})

	var stateEvents int
	c.On("state", func(any) { stateEvents++ })

	if err := c.Subscribe("sku_stream", "sku-1"); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	state, ok := c.GetState("sku_stream", "sku-1")
	if !ok {
		t.Fatal("expected subscription to exist")
	}
	if state["quantity"] != float64(10) {
		t.Fatalf("state = %#v", state)
	}
	if stateEvents != 1 {
		t.Fatalf("stateEvents = %d, want 1", stateEvents)
	}

	c.Unsubscribe("sku_stream", "sku-1")
	if _, ok := c.GetState("sku_stream", "sku-1"); ok {
		t.Fatal("expected subscription removed")
	}
}

func TestSelectFiresOnChange(t *testing.T) {
	qty := 10
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/state") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"snapshotJson":    map[string]any{"quantity": qty},
				"snapshotVersion": 1,
			})
			return
		}
		http.NotFound(w, r)
	})
	if err := c.Subscribe("sku_stream", "sku-1"); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	var values []any
	c.Select("sku_stream", "sku-1", func(state map[string]any) any {
		return state["quantity"]
	}, func(v any) { values = append(values, v) })

	if len(values) != 1 || values[0] != float64(10) {
		t.Fatalf("values after select = %#v", values)
	}

	// Simulate a patch_op-driven state change via a raw stream event.
	c.handleStreamEvent("sku_stream", map[string]any{
		"entity_id": "sku-1",
		"patch":     []any{map[string]any{"op": "replace", "path": "/quantity", "value": float64(95)}},
	})

	if len(values) != 2 || values[1] != float64(95) {
		t.Fatalf("values after patch = %#v", values)
	}
}

func TestIntentRefreshesSubscriptionViaStatePatch(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/state"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"snapshotJson":    map[string]any{"quantity": 10},
				"snapshotVersion": 1,
			})
		case strings.HasSuffix(r.URL.Path, "/intents/submit"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"accepted":    true,
				"executionId": "exec-1",
				"statePatch":  []any{map[string]any{"op": "replace", "path": "/quantity", "value": float64(5)}},
			})
		default:
			http.NotFound(w, r)
		}
	})

	if err := c.Subscribe("sku_stream", "sku-1"); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	var patchEvents int
	c.On("patch_op", func(any) { patchEvents++ })

	result, err := c.Intent("sku_stream", "sku-1", "adjust_stock", map[string]any{"qty": -5})
	if err != nil {
		t.Fatalf("Intent: %v", err)
	}
	if result["executionId"] != "exec-1" {
		t.Fatalf("result = %#v", result)
	}
	if patchEvents != 1 {
		t.Fatalf("patchEvents = %d, want 1", patchEvents)
	}
	state, _ := c.GetState("sku_stream", "sku-1")
	if state["quantity"] != float64(5) {
		t.Fatalf("state after intent = %#v", state)
	}
}

func TestGetTokenAndInitWithBearerToken(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {})
	if err := c.Init(context.Background()); err != nil {
		t.Fatalf("Init: %v", err)
	}
	tok, err := c.GetToken()
	if err != nil || tok != "test-token" {
		t.Fatalf("GetToken() = %q, %v", tok, err)
	}
}
