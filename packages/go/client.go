package causet

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// StreamConnectOptions configures a live stream subscription.
type StreamConnectOptions struct {
	Transport  StreamTransport
	FromCursor int64
}

type subscription struct {
	state  map[string]any
	cursor int64
}

type selectorEntry struct {
	streamID  string
	entityID  string
	selector  func(map[string]any) any
	handler   func(any)
	lastValue any
}

// Client is the Causet SDK entry point.
type Client struct {
	cfg          Config
	http         *http.Client
	tokenManager *TokenManager
	emitter      *Emitter

	subMu         sync.Mutex
	subscriptions map[string]*subscription

	selMu     sync.Mutex
	selectors []*selectorEntry

	streamMu     sync.Mutex
	streamCancel context.CancelFunc
	streamConn   *websocket.Conn
}

// NewClient creates a client from config.
func NewClient(cfg Config) *Client {
	cfg.Normalize()
	var tm *TokenManager
	if cfg.APIKey != "" {
		tm = NewTokenManager(cfg.APIURL, cfg.APIKey)
	}
	return &Client{
		cfg:           cfg,
		http:          &http.Client{Timeout: 120 * time.Second},
		tokenManager:  tm,
		emitter:       NewEmitter(),
		subscriptions: make(map[string]*subscription),
	}
}

func (c *Client) token() (string, error) {
	if c.tokenManager != nil {
		return c.tokenManager.GetToken()
	}
	if c.cfg.BearerToken != "" {
		return c.cfg.BearerToken, nil
	}
	return "", &AuthError{Message: "no api key or bearer token configured"}
}

// GetToken returns the current (or freshly exchanged) bearer token.
// Exposed for advanced/low-level integrations; normal usage should not need it.
func (c *Client) GetToken() (string, error) {
	return c.token()
}

// Init eagerly exchanges the API key for a JWT so the first request doesn't
// pay the exchange latency. No-op when configured with a static bearer token.
func (c *Client) Init(ctx context.Context) error {
	if c.tokenManager == nil {
		return nil
	}
	_, err := c.tokenManager.GetToken()
	return err
}

// Destroy disconnects any active stream. Included for parity with the other
// SDKs' destroy()/close(); the Go token manager has no background timers.
func (c *Client) Destroy() {
	c.DisconnectStream()
}

// On registers handler for eventType (e.g. "state", "stream_event",
// "patch_op", "stream_connected", "stream_disconnected", "error", "emitted").
// Returns an unsubscribe function.
func (c *Client) On(eventType string, handler EventHandler) func() {
	return c.emitter.On(eventType, handler)
}

func subKey(streamID, entityID string) string {
	return streamID + ":" + entityID
}

func deepCloneMap(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return map[string]any{}
	}
	return out
}

// Subscribe fetches entity state and caches it for GetState/Select. Emits a
// "state" event with {stream_id, entity_id, state}.
func (c *Client) Subscribe(streamID, entityID string) error {
	state, cursor, err := c.FetchState(streamID, entityID)
	if err != nil {
		return err
	}
	c.subMu.Lock()
	c.subscriptions[subKey(streamID, entityID)] = &subscription{state: deepCloneMap(state), cursor: cursor}
	c.subMu.Unlock()

	c.emitter.Emit("state", map[string]any{
		"stream_id": streamID, "entity_id": entityID, "state": c.stateCopy(streamID, entityID),
	})
	c.notifySelectors(streamID, entityID)
	return nil
}

// Unsubscribe removes cached state and any selectors watching that entity.
func (c *Client) Unsubscribe(streamID, entityID string) {
	c.subMu.Lock()
	delete(c.subscriptions, subKey(streamID, entityID))
	c.subMu.Unlock()

	c.selMu.Lock()
	kept := c.selectors[:0]
	for _, s := range c.selectors {
		if !(s.streamID == streamID && s.entityID == entityID) {
			kept = append(kept, s)
		}
	}
	c.selectors = kept
	c.selMu.Unlock()
}

// GetState returns the cached state for a subscribed entity (deep copy) and
// whether it was found. Use FetchState for a one-shot, uncached lookup.
func (c *Client) GetState(streamID, entityID string) (map[string]any, bool) {
	return c.stateCopy(streamID, entityID), c.hasSubscription(streamID, entityID)
}

func (c *Client) hasSubscription(streamID, entityID string) bool {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	_, ok := c.subscriptions[subKey(streamID, entityID)]
	return ok
}

func (c *Client) stateCopy(streamID, entityID string) map[string]any {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	sub, ok := c.subscriptions[subKey(streamID, entityID)]
	if !ok {
		return nil
	}
	return deepCloneMap(sub.state)
}

// Select watches derived state for one entity: selector runs against the
// cached state and handler fires whenever its (JSON-compared) output changes.
// The handler fires immediately if state is already cached. Returns an
// unsubscribe function.
func (c *Client) Select(streamID, entityID string, selector func(map[string]any) any, handler func(any)) func() {
	entry := &selectorEntry{streamID: streamID, entityID: entityID, selector: selector, handler: handler}
	if state := c.stateCopy(streamID, entityID); state != nil {
		entry.lastValue = selector(state)
		handler(entry.lastValue)
	}
	c.selMu.Lock()
	c.selectors = append(c.selectors, entry)
	c.selMu.Unlock()

	return func() {
		c.selMu.Lock()
		defer c.selMu.Unlock()
		for i, s := range c.selectors {
			if s == entry {
				c.selectors = append(c.selectors[:i], c.selectors[i+1:]...)
				break
			}
		}
	}
}

func (c *Client) notifySelectors(streamID, entityID string) {
	state := c.stateCopy(streamID, entityID)
	if state == nil {
		return
	}
	c.selMu.Lock()
	entries := append([]*selectorEntry(nil), c.selectors...)
	c.selMu.Unlock()

	for _, entry := range entries {
		if entry.streamID != streamID || entry.entityID != entityID {
			continue
		}
		next := entry.selector(state)
		nb, _ := json.Marshal(next)
		lb, _ := json.Marshal(entry.lastValue)
		if string(nb) != string(lb) {
			entry.lastValue = next
			entry.handler(next)
		}
	}
}

// refreshSubscriptionAfterEmit applies statePatch (if present) or refetches
// state for a subscribed entity after a successful Emit, then notifies
// "state"/"patch_op" listeners and selectors — mirrors the TS/Python clients.
func (c *Client) refreshSubscriptionAfterEmit(streamID, entityID string, result map[string]any) {
	c.subMu.Lock()
	sub, ok := c.subscriptions[subKey(streamID, entityID)]
	c.subMu.Unlock()
	if !ok {
		return
	}

	if patch, has := result["statePatch"]; has && patch != nil {
		ops := decodePatchOps(patch)
		if len(ops) > 0 {
			c.subMu.Lock()
			applyPatch(sub.state, ops)
			c.subMu.Unlock()
			c.emitter.Emit("patch_op", map[string]any{"stream_id": streamID, "entity_id": entityID, "ops": patch})
		}
	} else {
		state, cursor, err := c.FetchState(streamID, entityID)
		if err == nil {
			c.subMu.Lock()
			sub.state = deepCloneMap(state)
			sub.cursor = cursor
			c.subMu.Unlock()
		}
	}

	c.emitter.Emit("state", map[string]any{
		"stream_id": streamID, "entity_id": entityID, "state": c.stateCopy(streamID, entityID),
	})
	c.notifySelectors(streamID, entityID)
}

// handleStreamEvent routes a raw ledger/projection event from causet-realtime
// through the emitter: "stream_event" always, plus "patch_op"/"state"/
// "emitted" when the event carries a patch or emits for a cached entity.
func (c *Client) handleStreamEvent(streamID string, event map[string]any) {
	c.emitter.Emit("stream_event", map[string]any{"stream_id": streamID, "event": event})

	entityID, _ := event["entity_id"].(string)
	if patch, ok := event["patch"]; ok && entityID != "" {
		c.subMu.Lock()
		sub, exists := c.subscriptions[subKey(streamID, entityID)]
		c.subMu.Unlock()
		if exists {
			ops := decodePatchOps(patch)
			c.subMu.Lock()
			applyPatch(sub.state, ops)
			c.subMu.Unlock()
			c.emitter.Emit("patch_op", map[string]any{"stream_id": streamID, "entity_id": entityID, "ops": patch})
			c.emitter.Emit("state", map[string]any{
				"stream_id": streamID, "entity_id": entityID, "state": c.stateCopy(streamID, entityID),
			})
			c.notifySelectors(streamID, entityID)
		}
	}

	if emits, ok := event["emits"]; ok {
		c.emitter.Emit("emitted", map[string]any{"stream_id": streamID, "entity_id": entityID, "emits": emits})
	}
}

// ConnectStream subscribes to live events for streamID (optionally streamType:entityId).
// The event handler receives every raw ledger/projection event; the client
// additionally emits "stream_event"/"patch_op"/"state"/"emitted" via On(), and
// "stream_connected"/"stream_disconnected"/"error" for connection lifecycle.
func (c *Client) ConnectStream(ctx context.Context, streamID string, opts StreamConnectOptions, onEvent StreamEventHandler) (string, error) {
	c.DisconnectStream()
	transport := opts.Transport
	if transport == "" {
		transport = c.cfg.StreamTransport
	}
	wrapped := func(event map[string]any) {
		c.handleStreamEvent(streamID, event)
		if onEvent != nil {
			onEvent(event)
		}
	}
	hooks := streamHooks{
		onError: func(err error) { c.emitter.Emit("error", err) },
		onClose: func(transportName string) {
			c.emitter.Emit("stream_disconnected", map[string]any{"stream_id": streamID, "transport": transportName})
		},
	}
	if transport == StreamTransportSSE {
		connID, err := c.connectSSE(ctx, streamID, opts.FromCursor, wrapped, hooks)
		if err != nil {
			c.emitter.Emit("error", err)
			return "", err
		}
		c.emitter.Emit("stream_connected", map[string]any{"stream_id": streamID, "conn_id": connID, "transport": "sse"})
		return connID, nil
	}
	connID, err := c.connectWebSocket(ctx, streamID, opts.FromCursor, wrapped, hooks)
	if err != nil {
		c.emitter.Emit("error", err)
		return "", err
	}
	c.emitter.Emit("stream_connected", map[string]any{"stream_id": streamID, "conn_id": connID, "transport": "websocket"})
	return connID, nil
}

// DisconnectStream closes any active stream subscription.
func (c *Client) DisconnectStream() {
	c.streamMu.Lock()
	defer c.streamMu.Unlock()
	if c.streamCancel != nil {
		c.streamCancel()
		c.streamCancel = nil
	}
	if c.streamConn != nil {
		_ = c.streamConn.Close()
		c.streamConn = nil
	}
}
