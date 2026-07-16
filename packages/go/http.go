package causet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type httpConfig struct {
	apiURL       string
	platformSlug string
	appSlug      string
	forkID       string
	bearerToken  string
}

func (c *Client) httpCfg(token string) httpConfig {
	return httpConfig{
		apiURL:       c.cfg.APIURL,
		platformSlug: c.cfg.PlatformSlug,
		appSlug:      c.cfg.AppSlug,
		forkID:       c.cfg.ForkID,
		bearerToken:  token,
	}
}

func (c httpConfig) base() string {
	return fmt.Sprintf("%s/v1/platforms/%s/applications/%s",
		strings.TrimRight(c.apiURL, "/"),
		url.PathEscape(c.platformSlug),
		url.PathEscape(c.appSlug),
	)
}

func (c *Client) request(method, rawURL string, token string, body any, params map[string]string) ([]byte, int, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, 0, err
	}
	q := u.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, u.String(), reqBody)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := string(data)
		return data, resp.StatusCode, &APIError{StatusCode: resp.StatusCode, Message: msg}
	}
	return data, resp.StatusCode, nil
}

// FetchState loads entity state for the configured fork.
func (c *Client) FetchState(streamID, entityID string) (map[string]any, int64, error) {
	token, err := c.token()
	if err != nil {
		return nil, 0, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/entities/%s/%s/state", cfg.base(), url.PathEscape(streamID), url.PathEscape(entityID))
	data, _, err := c.request(http.MethodGet, rawURL, token, nil, map[string]string{"forkId": cfg.forkID})
	if err != nil {
		return nil, 0, err
	}
	var resp map[string]any
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, 0, err
	}
	state := resp
	if raw, ok := resp["snapshotJson"]; ok {
		switch v := raw.(type) {
		case string:
			_ = json.Unmarshal([]byte(v), &state)
		case map[string]any:
			state = v
		}
	}
	cursor := int64(0)
	if v, ok := resp["snapshotVersion"].(float64); ok {
		cursor = int64(v)
	}
	return state, cursor, nil
}

// SubmitIntent submits an intent to the Causet runtime and returns the raw
// response (accepted/executionId/error/statePatch). If entityID is subscribed
// (see Subscribe), the cached state is refreshed via statePatch or refetch
// and "state"/"patch_op" events are emitted.
//
// This submits an intent for processing; it does not directly append a committed
// business event.
func (c *Client) SubmitIntent(streamID, entityID, intentType string, payload map[string]any) (map[string]any, error) {
	result, err := c.submitIntentHTTP(streamID, entityID, intentType, payload, "")
	if err != nil {
		return nil, err
	}
	if accepted, _ := result["accepted"].(bool); accepted {
		c.refreshSubscriptionAfterIntent(streamID, entityID, result)
	}
	return result, nil
}

// Intent is deprecated; use SubmitIntent.
func (c *Client) Intent(streamID, entityID, intentType string, payload map[string]any) (map[string]any, error) {
	return c.SubmitIntent(streamID, entityID, intentType, payload)
}

func (c *Client) submitIntentHTTP(streamID, entityID, intentType string, payload map[string]any, intentID string) (map[string]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/v1/runtime/platforms/%s/applications/%s/intents/submit",
		strings.TrimRight(cfg.apiURL, "/"),
		url.PathEscape(cfg.platformSlug),
		url.PathEscape(cfg.appSlug),
	)
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
	data, _, err := c.request(http.MethodPost, rawURL, token, body, nil)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}
