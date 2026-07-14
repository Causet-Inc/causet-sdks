package causet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEmitStreamDeliversEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime/stream/platforms/plat/applications/app/intents/submit" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("missing Accept header")
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("ResponseWriter does not support flushing")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: START\ndata: {\"status\":\"START\"}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "event: COMPLETE\ndata: {\"status\":\"COMPLETE\"}\n\n")
		flusher.Flush()
	}))
	defer srv.Close()

	c := NewClient(Config{
		APIURL:       srv.URL,
		PlatformSlug: "plat",
		AppSlug:      "app",
		ForkID:       "sandbox",
		BearerToken:  "test-token",
	})

	var events []SseEvent
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := c.EmitStream(ctx, "sku_stream", "sku-1", "adjust_stock", map[string]any{"qty": 5}, func(ev SseEvent) {
		events = append(events, ev)
	}, "")
	if err != nil {
		t.Fatalf("EmitStream: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("events = %#v", events)
	}
	if events[0].Event != "START" || events[1].Event != "COMPLETE" {
		t.Fatalf("events = %#v", events)
	}
	data, ok := events[1].Data.(map[string]any)
	if !ok || data["status"] != "COMPLETE" {
		t.Fatalf("events[1].Data = %#v", events[1].Data)
	}
}

func TestEmitStreamGeneratesIntentIDWhenEmpty(t *testing.T) {
	var capturedIntentID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if v, ok := body["intentId"].(string); ok {
			capturedIntentID = v
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(Config{APIURL: srv.URL, PlatformSlug: "plat", AppSlug: "app", BearerToken: "t"})
	err := c.EmitStream(context.Background(), "s", "e", "TYPE", map[string]any{}, func(SseEvent) {}, "")
	if err != nil {
		t.Fatalf("EmitStream: %v", err)
	}
	if capturedIntentID == "" {
		t.Fatal("expected an auto-generated intentId")
	}
}
