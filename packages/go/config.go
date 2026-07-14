package causet

// StreamTransport selects how live stream events are delivered.
type StreamTransport string

const (
	StreamTransportWebSocket StreamTransport = "websocket"
	StreamTransportSSE       StreamTransport = "sse"
)

// Config holds SDK connection settings.
type Config struct {
	APIURL          string
	PlatformSlug    string
	AppSlug         string
	ForkID          string
	WSURL           string
	RealtimeURL     string
	StreamTransport StreamTransport
	BearerToken     string
	APIKey          string
}

// Normalize fills defaults on cfg.
func (c *Config) Normalize() {
	if c.ForkID == "" {
		c.ForkID = "main"
	}
	if c.RealtimeURL == "" {
		c.RealtimeURL = DeriveRealtimeURL(c.APIURL)
	}
	if c.WSURL == "" {
		c.WSURL = DeriveWSURLFromRealtime(c.RealtimeURL)
	}
	if c.StreamTransport == "" {
		c.StreamTransport = StreamTransportWebSocket
	}
}
