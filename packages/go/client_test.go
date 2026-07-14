package causet

import "testing"

func TestDeriveRealtimeURLSandbox(t *testing.T) {
	got := DeriveRealtimeURL("https://sandbox.api.causet.cloud")
	if got != "https://sandbox.realtime.causet.cloud" {
		t.Fatalf("got %q", got)
	}
}

func TestDeriveWSURLSandbox(t *testing.T) {
	got := DeriveWSURL("https://sandbox.api.causet.cloud")
	if got != "wss://sandbox.realtime.causet.cloud/ws" {
		t.Fatalf("got %q", got)
	}
}

func TestDeriveWSURL(t *testing.T) {
	if got := DeriveWSURL("https://api.example.com"); got != "wss://api.example.com/ws" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildStreamEventsURL(t *testing.T) {
	cfg := httpConfig{platformSlug: "plat", appSlug: "app", forkID: "sandbox"}
	u := BuildStreamEventsURL("https://api.example.com", cfg, StreamEventsURLOptions{
		StreamID: "orders:1", FromCursor: 5, Token: "jwt",
	})
	if u == "" {
		t.Fatal("empty url")
	}
}

func TestConfigNormalize(t *testing.T) {
	cfg := Config{APIURL: "https://api.example.com/"}
	cfg.Normalize()
	if cfg.ForkID != "main" {
		t.Fatalf("fork %q", cfg.ForkID)
	}
	if cfg.StreamTransport != StreamTransportWebSocket {
		t.Fatalf("transport %q", cfg.StreamTransport)
	}
}
