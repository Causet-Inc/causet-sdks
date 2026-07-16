package causet

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// SseEvent is a parsed Server-Sent Event: Data is the JSON-decoded payload
// when possible, otherwise the raw string.
type SseEvent struct {
	ID    string
	Event string
	Data  any
}

// IntentStream submits an intent and streams its execution progress
// (START, COMPLETE, ERROR, …) via SSE. Unlike Intent, this call blocks the
// calling goroutine until the stream closes; run it in its own goroutine for
// non-blocking use. intentID is optional — pass "" to auto-generate one.
// Parameter order mirrors the other Causet SDKs: (..., payload, onEvent, intentID).
func (c *Client) IntentStream(ctx context.Context, streamID, entityID, intentType string, payload map[string]any, onEvent func(SseEvent), intentID string) error {
	token, err := c.token()
	if err != nil {
		return err
	}
	cfg := c.httpCfg(token)
	if intentID == "" {
		intentID = generateIntentID()
	}
	body := map[string]any{
		"intentId":   intentID,
		"forkId":     cfg.forkID,
		"streamId":   streamID,
		"entityId":   entityID,
		"intentType": intentType,
		"payload":    payload,
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}

	rawURL := fmt.Sprintf("%s/v1/runtime/stream/platforms/%s/applications/%s/intents/submit",
		strings.TrimRight(cfg.apiURL, "/"), url.PathEscape(cfg.platformSlug), url.PathEscape(cfg.appSlug))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return &APIError{StatusCode: resp.StatusCode, Message: string(data)}
	}

	reader := bufio.NewReader(resp.Body)
	var block bytes.Buffer
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		line, err := reader.ReadString('\n')
		if err != nil {
			if block.Len() > 0 {
				if ev, ok := parseSseEventBlock(block.String()); ok {
					onEvent(ev)
				}
			}
			if err == io.EOF {
				return nil
			}
			return err
		}
		if line == "\n" || line == "\r\n" {
			if block.Len() == 0 {
				continue
			}
			if ev, ok := parseSseEventBlock(block.String()); ok {
				onEvent(ev)
			}
			block.Reset()
			continue
		}
		block.WriteString(line)
	}
}

func parseSseEventBlock(block string) (SseEvent, bool) {
	var id, eventType string
	var dataLines []string
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case strings.HasPrefix(line, "id:"):
			id = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimPrefix(line, "data:"))
		}
	}
	if len(dataLines) == 0 {
		return SseEvent{}, false
	}
	raw := strings.Join(dataLines, "\n")
	var data any
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		data = strings.TrimSpace(raw)
	}
	return SseEvent{ID: id, Event: eventType, Data: data}, true
}
