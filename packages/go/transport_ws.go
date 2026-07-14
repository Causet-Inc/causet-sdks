package causet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type StreamEventHandler func(event map[string]any)

// streamHooks carries connection-lifecycle callbacks shared by the WebSocket
// and SSE transports, so Client.ConnectStream can surface "error" and
// "stream_disconnected" events regardless of transport.
type streamHooks struct {
	onError func(err error)
	onClose func(transport string)
}

type wsTransport struct {
	onEvent StreamEventHandler
	onError func(err error)
	onClose func()
	conn    *websocket.Conn
}

func (c *Client) connectWebSocket(ctx context.Context, streamID string, fromCursor int64, onEvent StreamEventHandler, hooks streamHooks) (string, error) {
	token, err := c.token()
	if err != nil {
		return "", err
	}
	u, err := url.Parse(c.cfg.WSURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	if c.cfg.APIKey != "" {
		q.Set("api_key", c.cfg.APIKey)
	}
	if token != "" {
		q.Set("token", token)
	}
	u.RawQuery = q.Encode()

	hdr := http.Header{}
	if token != "" {
		hdr.Set("Authorization", "Bearer "+token)
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, u.String(), hdr)
	if err != nil {
		return "", err
	}

	subs := []map[string]any{{"channel": "ledger"}, {"channel": "state"}}
	if fromCursor > 0 {
		for i := range subs {
			subs[i]["from_cursor"] = fromCursor
		}
	}
	hello := map[string]any{
		"type": "hello", "v": 1,
		"stream_id": streamID,
		"fork_id":   c.cfg.ForkID,
		"subs":      subs,
	}
	if err := conn.WriteJSON(hello); err != nil {
		_ = conn.Close()
		return "", err
	}
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	var welcome map[string]any
	if err := conn.ReadJSON(&welcome); err != nil {
		_ = conn.Close()
		return "", err
	}
	if welcome["type"] == "error" {
		_ = conn.Close()
		return "", fmt.Errorf("websocket hello failed: %v", welcome["message"])
	}
	connID, _ := welcome["conn_id"].(string)
	_ = conn.SetReadDeadline(time.Time{})

	ctx2, cancel := context.WithCancel(context.Background())
	t := &wsTransport{
		onEvent: onEvent,
		conn:    conn,
		onError: hooks.onError,
		onClose: func() {
			if hooks.onClose != nil {
				hooks.onClose("websocket")
			}
		},
	}
	c.streamMu.Lock()
	c.streamCancel = cancel
	c.streamConn = conn
	c.streamMu.Unlock()
	go t.readLoop(ctx2)
	return connID, nil
}

func (t *wsTransport) readLoop(ctx context.Context) {
	defer func() {
		if t.onClose != nil {
			t.onClose()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_, raw, err := t.conn.ReadMessage()
		if err != nil {
			if t.onError != nil && !strings.Contains(err.Error(), "use of closed network connection") {
				t.onError(err)
			}
			return
		}
		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if typ, _ := msg["type"].(string); typ == "welcome" || typ == "pong" || typ == "error" {
			if typ == "error" && t.onError != nil {
				t.onError(fmt.Errorf("%v", msg["message"]))
			}
			continue
		}
		if t.onEvent != nil {
			t.onEvent(msg)
		}
	}
}
