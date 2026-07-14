package causet

import "fmt"

type Error struct {
	Message string
}

func (e *Error) Error() string { return e.Message }

type APIError struct {
	StatusCode int
	Message    string
	Body       any
}

func (e *APIError) Error() string {
	return fmt.Sprintf("causet api error %d: %s", e.StatusCode, e.Message)
}

type AuthError struct {
	Message string
}

func (e *AuthError) Error() string { return e.Message }
