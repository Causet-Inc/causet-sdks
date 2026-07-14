package causet

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// QueryOptions configures pagination for RunQuery.
type QueryOptions struct {
	Limit        int
	Offset       int
	Cursor       string
	IncludeTotal bool
}

// ListEntitiesOptions filters ListEntities.
type ListEntitiesOptions struct {
	StreamName   string
	SearchPrefix string
	Cursor       string
	Limit        int
}

func (c *Client) get(rawURL string, params map[string]string) (map[string]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	data, _, err := c.request(http.MethodGet, rawURL, token, nil, params)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if len(data) == 0 {
		return map[string]any{}, nil
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (c *Client) getList(rawURL string, params map[string]string) ([]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	data, _, err := c.request(http.MethodGet, rawURL, token, nil, params)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return []any{}, nil
	}
	var result []any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// RunQuery runs a named query via POST .../forks/{forkId}/queries/{slug}/run.
// input values are stringified for the API (lists/maps become JSON strings).
// Limit/Offset/Cursor are pagination for the HTTP layer, independent of any
// DSL input parameter of the same name.
func (c *Client) RunQuery(querySlug string, input map[string]any, opts QueryOptions) (map[string]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/forks/%s/queries/%s/run", cfg.base(), url.PathEscape(cfg.forkID), url.PathEscape(querySlug))
	body := map[string]any{"input": stringifyQueryInput(input)}
	if opts.Limit > 0 {
		body["limit"] = opts.Limit
	}
	if opts.Cursor != "" {
		body["cursor"] = opts.Cursor
	} else if opts.Offset > 0 {
		body["offset"] = opts.Offset
	}
	if opts.IncludeTotal {
		body["include_total"] = true
	}
	data, _, err := c.request(http.MethodPost, rawURL, token, body, nil)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if len(data) > 0 {
		if err := json.Unmarshal(data, &result); err != nil {
			return nil, err
		}
	}
	if result == nil {
		result = map[string]any{"items": []any{}}
	}
	if items, ok := result["items"].([]any); ok {
		result["items"] = flattenProjectionItems(items)
	}
	return result, nil
}

// ListQueries returns every named query defined for the current fork.
func (c *Client) ListQueries() ([]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/forks/%s/queries", cfg.base(), url.PathEscape(cfg.forkID))
	return c.getList(rawURL, nil)
}

// GetQueryDefinition returns the IR definition for a single named query.
func (c *Client) GetQueryDefinition(querySlug string) (map[string]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/forks/%s/queries/%s", cfg.base(), url.PathEscape(cfg.forkID), url.PathEscape(querySlug))
	return c.get(rawURL, nil)
}

// ListProjections returns every projection table defined for the current fork.
func (c *Client) ListProjections() ([]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/forks/%s/projections", cfg.base(), url.PathEscape(cfg.forkID))
	return c.getList(rawURL, nil)
}

// ListEntities returns a page of entity ids, optionally filtered by stream
// name and/or id prefix.
func (c *Client) ListEntities(opts ListEntitiesOptions) (map[string]any, error) {
	token, err := c.token()
	if err != nil {
		return nil, err
	}
	cfg := c.httpCfg(token)
	rawURL := fmt.Sprintf("%s/entities", cfg.base())
	params := map[string]string{"forkId": cfg.forkID}
	if opts.StreamName != "" {
		params["streamName"] = opts.StreamName
	}
	if opts.SearchPrefix != "" {
		params["searchPrefix"] = opts.SearchPrefix
	}
	if opts.Cursor != "" {
		params["cursor"] = opts.Cursor
	}
	if opts.Limit > 0 {
		params["limit"] = strings.TrimSpace(fmt.Sprintf("%d", opts.Limit))
	}
	return c.get(rawURL, params)
}
