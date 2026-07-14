package causet

import "sync"

// EventHandler receives event data emitted by the client (state changes,
// stream events, errors, etc). The concrete type of data depends on eventType.
type EventHandler func(data any)

// WildcardHandler receives every event with its type, for logging/debugging.
type WildcardHandler func(eventType string, data any)

// Emitter is a minimal thread-safe pub/sub bus, mirroring the Emitter used by
// the TypeScript and Python SDKs (On/Emit map to their on/emit).
type Emitter struct {
	mu        sync.Mutex
	handlers  map[string][]*EventHandler
	wildcards []*WildcardHandler
}

// NewEmitter creates an empty Emitter.
func NewEmitter() *Emitter {
	return &Emitter{handlers: make(map[string][]*EventHandler)}
}

// On registers handler for eventType ("*" subscribes to every event via a
// WildcardHandler-shaped call is not supported here — use OnAny for that).
// Returns an unsubscribe function.
func (e *Emitter) On(eventType string, handler EventHandler) func() {
	e.mu.Lock()
	defer e.mu.Unlock()
	ptr := &handler
	e.handlers[eventType] = append(e.handlers[eventType], ptr)
	return func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		list := e.handlers[eventType]
		for i, h := range list {
			if h == ptr {
				e.handlers[eventType] = append(list[:i], list[i+1:]...)
				break
			}
		}
	}
}

// OnAny registers a wildcard handler invoked for every emitted event.
// Returns an unsubscribe function.
func (e *Emitter) OnAny(handler WildcardHandler) func() {
	e.mu.Lock()
	defer e.mu.Unlock()
	ptr := &handler
	e.wildcards = append(e.wildcards, ptr)
	return func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		for i, h := range e.wildcards {
			if h == ptr {
				e.wildcards = append(e.wildcards[:i], e.wildcards[i+1:]...)
				break
			}
		}
	}
}

// Emit invokes every handler registered for eventType, then every wildcard
// handler. Handler panics are recovered so one bad handler cannot break the
// stream/event loop that triggered the emit.
func (e *Emitter) Emit(eventType string, data any) {
	e.mu.Lock()
	handlers := append([]*EventHandler(nil), e.handlers[eventType]...)
	wildcards := append([]*WildcardHandler(nil), e.wildcards...)
	e.mu.Unlock()

	for _, h := range handlers {
		callHandlerSafely(*h, data)
	}
	for _, w := range wildcards {
		callWildcardSafely(*w, eventType, data)
	}
}

func callHandlerSafely(h EventHandler, data any) {
	defer func() { _ = recover() }()
	h(data)
}

func callWildcardSafely(h WildcardHandler, eventType string, data any) {
	defer func() { _ = recover() }()
	h(eventType, data)
}
