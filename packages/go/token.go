package causet

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type TokenManager struct {
	apiURL string
	apiKey string
	client *http.Client

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

func NewTokenManager(apiURL, apiKey string) *TokenManager {
	return &TokenManager{
		apiURL: strings.TrimRight(apiURL, "/"),
		apiKey: apiKey,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (m *TokenManager) GetToken() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.token != "" && time.Now().Before(m.expiresAt.Add(-30*time.Second)) {
		return m.token, nil
	}
	return m.exchange()
}

func (m *TokenManager) exchange() (string, error) {
	req, err := http.NewRequest(http.MethodPost, m.apiURL+"/v1/token", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "ApiKey "+m.apiKey)
	resp, err := m.client.Do(req)
	if err != nil {
		return "", &AuthError{Message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", &AuthError{Message: fmt.Sprintf("token exchange failed: %d %s", resp.StatusCode, string(body))}
	}
	var data struct {
		Token     string `json:"token"`
		ExpiresIn int    `json:"expiresIn"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if data.Token == "" {
		return "", &AuthError{Message: "token exchange returned empty token"}
	}
	m.token = data.Token
	ttl := data.ExpiresIn
	if ttl <= 0 {
		ttl = 300
	}
	m.expiresAt = time.Now().Add(time.Duration(ttl) * time.Second)
	return m.token, nil
}
