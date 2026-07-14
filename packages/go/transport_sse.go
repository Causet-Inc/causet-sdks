package causet

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func (c *Client) connectSSE(ctx context.Context, streamID string, fromCursor int64, onEvent StreamEventHandler, hooks streamHooks) (string, error) {
	token, err := c.token()
	if err != nil {
		return "", err
	}
	cfg := c.httpCfg(token)
	rawURL := BuildStreamEventsURL(c.cfg.RealtimeURL, cfg, StreamEventsURLOptions{
		StreamID:   streamID,
		FromCursor: fromCursor,
		Token:      token,
		APIKey:     c.cfg.APIKey,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return "", &APIError{StatusCode: resp.StatusCode, Message: string(body)}
	}

	connID := "sse-" + streamID
	ctx2, cancel := context.WithCancel(ctx)
	c.streamMu.Lock()
	c.streamCancel = cancel
	c.streamMu.Unlock()
	go c.readSSE(ctx2, resp.Body, onEvent, hooks)
	return connID, nil
}

func (c *Client) readSSE(ctx context.Context, body io.ReadCloser, onEvent StreamEventHandler, hooks streamHooks) {
	defer body.Close()
	defer func() {
		if hooks.onClose != nil {
			hooks.onClose("sse")
		}
	}()
	reader := bufio.NewReader(body)
	var block bytes.Buffer
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		line, err := reader.ReadString('\n')
		if err != nil {
			if hooks.onError != nil && err != io.EOF {
				hooks.onError(err)
			}
			return
		}
		if line == "\n" || line == "\r\n" {
			if block.Len() == 0 {
				continue
			}
			for _, ev := range parseSSEBlock(block.String()) {
				if onEvent != nil && ev != nil {
					onEvent(ev)
				}
			}
			block.Reset()
			continue
		}
		block.WriteString(line)
	}
}

func parseSSEBlock(block string) []map[string]any {
	var dataLines []string
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if len(dataLines) == 0 {
		return nil
	}
	raw := strings.Join(dataLines, "\n")
	var ev map[string]any
	if err := json.Unmarshal([]byte(raw), &ev); err != nil {
		return nil
	}
	return []map[string]any{ev}
}
