package causet

import (
	"fmt"
	"net/url"
)

type StreamEventsURLOptions struct {
	StreamID   string
	ForkID     string
	FromCursor int64
	Token      string
	APIKey     string
}

func BuildStreamEventsURL(realtimeURL string, cfg httpConfig, opts StreamEventsURLOptions) string {
	fork := opts.ForkID
	if fork == "" {
		fork = cfg.forkID
	}
	u := fmt.Sprintf("%s/v1/platforms/%s/applications/%s/streams/%s/events",
		DeriveRealtimeURL(realtimeURL),
		url.PathEscape(cfg.platformSlug),
		url.PathEscape(cfg.appSlug),
		url.PathEscape(opts.StreamID),
	)
	q := url.Values{}
	q.Set("fork_id", fork)
	if opts.FromCursor > 0 {
		q.Set("from_cursor", fmt.Sprintf("%d", opts.FromCursor))
	}
	if opts.Token != "" {
		q.Set("token", opts.Token)
	}
	if opts.APIKey != "" {
		q.Set("api_key", opts.APIKey)
	}
	return u + "?" + q.Encode()
}
