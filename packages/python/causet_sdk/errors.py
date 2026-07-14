from __future__ import annotations

from typing import Any


class CausetError(Exception):
    """Base error for all Causet SDK errors."""


class CausetAuthError(CausetError):
    """Authentication or token exchange failure."""


class CausetApiError(CausetError):
    """HTTP API returned a non-2xx response."""

    def __init__(self, status_code: int, message: str, body: Any = None) -> None:
        self.status_code = status_code
        self.message = message
        self.body = body
        super().__init__(f"[{status_code}] {message}")
