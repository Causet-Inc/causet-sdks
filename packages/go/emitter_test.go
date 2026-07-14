package causet

import "testing"

func TestEmitterOnAndEmit(t *testing.T) {
	e := NewEmitter()
	var got any
	calls := 0
	e.On("state", func(data any) {
		calls++
		got = data
	})
	e.Emit("state", map[string]any{"x": 1})
	if calls != 1 {
		t.Fatalf("calls = %d, want 1", calls)
	}
	if m, ok := got.(map[string]any); !ok || m["x"] != 1 {
		t.Fatalf("got = %#v", got)
	}
}

func TestEmitterUnsubscribe(t *testing.T) {
	e := NewEmitter()
	calls := 0
	unsub := e.On("evt", func(any) { calls++ })
	e.Emit("evt", nil)
	unsub()
	e.Emit("evt", nil)
	if calls != 1 {
		t.Fatalf("calls = %d, want 1", calls)
	}
}

func TestEmitterWildcard(t *testing.T) {
	e := NewEmitter()
	var seenType string
	e.OnAny(func(eventType string, data any) { seenType = eventType })
	e.Emit("foo", "bar")
	if seenType != "foo" {
		t.Fatalf("seenType = %q", seenType)
	}
}

func TestEmitterDoesNotCrossFireEventTypes(t *testing.T) {
	e := NewEmitter()
	calls := 0
	e.On("a", func(any) { calls++ })
	e.Emit("b", nil)
	if calls != 0 {
		t.Fatalf("calls = %d, want 0", calls)
	}
}

func TestEmitterHandlerPanicIsRecovered(t *testing.T) {
	e := NewEmitter()
	e.On("evt", func(any) { panic("boom") })
	calls := 0
	e.On("evt", func(any) { calls++ })
	e.Emit("evt", nil)
	if calls != 1 {
		t.Fatalf("second handler should still run, calls = %d", calls)
	}
}
