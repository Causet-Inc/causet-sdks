package causet

import (
	"net/url"
	"strings"
)

var realtimeHostByAPI = map[string]string{
	"sandbox.api.causet.cloud": "sandbox.realtime.causet.cloud",
	"api.causet.cloud":         "realtime.causet.cloud",
}

// DeriveRealtimeURL maps SaaS API URL to causet-realtime HTTP base.
func DeriveRealtimeURL(apiURL string) string {
	trimmed := strings.TrimRight(apiURL, "/")
	u, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}
	if mapped, ok := realtimeHostByAPI[u.Hostname()]; ok {
		u.Host = mapped
		return u.Scheme + "://" + u.Host
	}
	if u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" {
		port := u.Port()
		if port == "" || port == "8085" {
			u.Host = u.Hostname() + ":8081"
		}
		return u.Scheme + "://" + u.Host
	}
	if strings.Contains(u.Hostname(), ".api.") {
		u.Host = strings.Replace(u.Hostname(), ".api.", ".realtime.", 1)
		if u.Port() != "" {
			u.Host += ":" + u.Port()
		}
		return u.Scheme + "://" + u.Host
	}
	return trimmed
}

// DeriveWSURL returns WebSocket URL from API URL via realtime mapping.
func DeriveWSURL(apiURL string) string {
	return DeriveWSURLFromRealtime(DeriveRealtimeURL(apiURL))
}

// DeriveWSURLFromRealtime converts realtime HTTP base to wss/ws URL.
func DeriveWSURLFromRealtime(realtimeURL string) string {
	u := strings.TrimRight(realtimeURL, "/")
	switch {
	case strings.HasPrefix(u, "https://"):
		return strings.Replace(u, "https://", "wss://", 1) + "/ws"
	case strings.HasPrefix(u, "http://"):
		return strings.Replace(u, "http://", "ws://", 1) + "/ws"
	default:
		return u + "/ws"
	}
}
