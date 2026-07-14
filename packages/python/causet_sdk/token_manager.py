"""API key → Bearer JWT exchange and automatic refresh.

Mirrors ApiKeyTokenManager.js from the JavaScript SDK.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx

from causet_sdk.errors import CausetAuthError

logger = logging.getLogger(__name__)

_REFRESH_BUFFER_S = 30
# Transient disconnects (Causet / proxy restarting, TLS glitch) — retry before failing.
_MAX_TOKEN_EXCHANGE_ATTEMPTS = 4
_TOKEN_EXCHANGE_RETRY_BASE_S = 0.35
_RETRYABLE_EXCHANGE_ERRORS: tuple[type[BaseException], ...] = (
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.ReadTimeout,
    httpx.WriteTimeout,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
)


class ApiKeyTokenManager:
    """Exchanges a Causet API key for a short-lived Bearer JWT and refreshes
    it automatically before expiry.

    Token lifecycle (server default):
      - ``expiresIn``: 300 s (5 min)
      - Refresh fires ``_REFRESH_BUFFER_S`` seconds before expiry
      - Concurrent callers share a single in-flight fetch
    """

    def __init__(self, api_url: str, api_key: str) -> None:
        self._api_url = api_url.rstrip("/")
        self._api_key = api_key

        self._token: Optional[str] = None
        self._expires_at: float = 0.0
        self._inflight: Optional[asyncio.Task[str]] = None
        self._refresh_task: Optional[asyncio.Task[None]] = None

    async def get_token(self) -> str:
        """Return a valid Bearer token, exchanging or refreshing as needed.

        Safe to call concurrently — in-flight requests are coalesced.
        """
        refresh_at = self._expires_at - _REFRESH_BUFFER_S
        if self._token and time.time() < refresh_at:
            return self._token

        if self._inflight is not None and not self._inflight.done():
            return await self._inflight

        loop = asyncio.get_running_loop()
        self._inflight = loop.create_task(self._exchange())
        try:
            return await self._inflight
        finally:
            self._inflight = None

    async def init(self) -> None:
        """Eagerly exchange the API key. Optional — ``get_token`` is lazy."""
        await self.get_token()

    async def force_refresh(self) -> str:
        """Discard the cached JWT and fetch a new one.

        Call this after HTTP **401** when the server rejects a token that still looks
        valid locally (clock skew, early invalidation, or a stale in-memory token).
        """
        if self._refresh_task is not None:
            self._refresh_task.cancel()
            self._refresh_task = None
        self._token = None
        self._expires_at = 0.0
        if self._inflight is not None:
            if not self._inflight.done():
                self._inflight.cancel()
                try:
                    await self._inflight
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.debug("Prior token exchange finished with error", exc_info=True)
            self._inflight = None
        return await self.get_token()

    def destroy(self) -> None:
        """Cancel background refresh and release resources."""
        if self._refresh_task is not None:
            self._refresh_task.cancel()
            self._refresh_task = None

    async def _exchange(self) -> str:
        timeout = httpx.Timeout(120.0, connect=20.0)
        resp: httpx.Response | None = None
        for attempt in range(_MAX_TOKEN_EXCHANGE_ATTEMPTS):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(
                        f"{self._api_url}/v1/token",
                        headers={"Authorization": f"ApiKey {self._api_key}"},
                    )
                break
            except _RETRYABLE_EXCHANGE_ERRORS as e:
                if attempt + 1 >= _MAX_TOKEN_EXCHANGE_ATTEMPTS:
                    logger.error(
                        "Causet token exchange failed after %s attempts",
                        _MAX_TOKEN_EXCHANGE_ATTEMPTS,
                        exc_info=True,
                    )
                    raise CausetAuthError(
                        "Causet auth unreachable (network error while exchanging API key). "
                        "Check that CAUSET_API_URL points at a running Causet API and retry."
                    ) from e
                delay = _TOKEN_EXCHANGE_RETRY_BASE_S * (2**attempt)
                logger.warning(
                    "Causet token exchange transient error (attempt %s/%s), retry in %.2fs: %s",
                    attempt + 1,
                    _MAX_TOKEN_EXCHANGE_ATTEMPTS,
                    delay,
                    e,
                )
                await asyncio.sleep(delay)

        assert resp is not None
        if resp.status_code != 200:
            body = resp.json() if resp.content else {}
            raise CausetAuthError(
                body.get("error", f"Token exchange failed: {resp.status_code}")
            )

        data = resp.json()
        token = data.get("token")
        if not token:
            raise CausetAuthError("Token exchange returned no token")

        expires_in = data.get("expiresIn", 300)
        self._token = token
        self._expires_at = time.time() + expires_in

        self._schedule_refresh()
        return token

    def _schedule_refresh(self) -> None:
        if self._refresh_task is not None:
            self._refresh_task.cancel()

        delay = self._expires_at - time.time() - _REFRESH_BUFFER_S
        if delay <= 0:
            return

        async def _bg_refresh() -> None:
            await asyncio.sleep(delay)
            try:
                await self._exchange()
            except Exception:
                logger.warning("Background token refresh failed", exc_info=True)

        self._refresh_task = asyncio.get_running_loop().create_task(_bg_refresh())
