import asyncio
import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx

from causet_sdk.token_manager import ApiKeyTokenManager
from causet_sdk.errors import CausetAuthError

API_URL = "https://api.causet.cloud"
API_KEY = "ck_live_test.secret123"


@pytest.fixture
def mock_token_endpoint():
    with respx.mock:
        yield respx.post(f"{API_URL}/v1/token")


class TestApiKeyTokenManager:
    async def test_exchange_returns_token(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-abc", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            token = await mgr.get_token()
            assert token == "jwt-abc"
        finally:
            mgr.destroy()

    async def test_uses_api_key_header(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-abc", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            await mgr.get_token()
            req = mock_token_endpoint.calls[0].request
            assert req.headers["authorization"] == f"ApiKey {API_KEY}"
        finally:
            mgr.destroy()

    async def test_cached_token_not_refetched(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-abc", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            t1 = await mgr.get_token()
            t2 = await mgr.get_token()
            assert t1 == t2
            assert mock_token_endpoint.call_count == 1
        finally:
            mgr.destroy()

    async def test_concurrent_calls_coalesced(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-coalesced", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            tokens = await asyncio.gather(
                mgr.get_token(), mgr.get_token(), mgr.get_token()
            )
            assert all(t == "jwt-coalesced" for t in tokens)
            assert mock_token_endpoint.call_count == 1
        finally:
            mgr.destroy()

    async def test_exchange_failure_raises_auth_error(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            401, json={"error": "Invalid API key"}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            with pytest.raises(CausetAuthError, match="Invalid API key"):
                await mgr.get_token()
        finally:
            mgr.destroy()

    async def test_init_eagerly_exchanges(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-eager", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            await mgr.init()
            assert mock_token_endpoint.call_count == 1
        finally:
            mgr.destroy()

    async def test_destroy_cancels_refresh(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-abc", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        await mgr.init()
        mgr.destroy()
        assert mgr._refresh_task is None or mgr._refresh_task.cancelled()

    async def test_force_refresh_fetches_new_token(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-first", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            t1 = await mgr.get_token()
            assert t1 == "jwt-first"
            mock_token_endpoint.return_value = httpx.Response(
                200, json={"token": "jwt-second", "expiresIn": 300}
            )
            t2 = await mgr.force_refresh()
            assert t2 == "jwt-second"
            assert mock_token_endpoint.call_count == 2
        finally:
            mgr.destroy()

    async def test_network_retry_then_success(self, mock_token_endpoint):
        mock_token_endpoint.side_effect = [
            httpx.ConnectError("connection refused"),
            httpx.Response(200, json={"token": "jwt-after-retry", "expiresIn": 300}),
        ]
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            with patch("causet_sdk.token_manager.asyncio.sleep", new_callable=AsyncMock):
                token = await mgr.get_token()
            assert token == "jwt-after-retry"
            assert mock_token_endpoint.call_count == 2
        finally:
            mgr.destroy()

    async def test_network_retry_exhausted_raises(self, mock_token_endpoint):
        mock_token_endpoint.side_effect = httpx.ConnectError("down")
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            with patch("causet_sdk.token_manager.asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(CausetAuthError, match="unreachable"):
                    await mgr.get_token()
            assert mock_token_endpoint.call_count == 4
        finally:
            mgr.destroy()

    async def test_no_token_in_response_raises(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(200, json={"expiresIn": 300})
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            with pytest.raises(CausetAuthError, match="no token"):
                await mgr.get_token()
        finally:
            mgr.destroy()

    async def test_background_refresh_scheduled(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-bg", "expiresIn": 120}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            await mgr.get_token()
            assert mgr._refresh_task is not None
            assert not mgr._refresh_task.done()
            mock_token_endpoint.return_value = httpx.Response(
                200, json={"token": "jwt-refreshed", "expiresIn": 120}
            )
            mgr._refresh_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await mgr._refresh_task
        finally:
            mgr.destroy()

    async def test_background_refresh_runs_exchange(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-first", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            await mgr.get_token()
            original_task = mgr._refresh_task
            assert original_task is not None
            mgr._expires_at = time.time() + 5
            delay = mgr._expires_at - time.time() - 30
            assert delay <= 0
            mgr._schedule_refresh()
            mock_token_endpoint.return_value = httpx.Response(
                200, json={"token": "jwt-bg", "expiresIn": 300}
            )
            await mgr._exchange()
            assert mgr._token == "jwt-bg"
        finally:
            mgr.destroy()

    async def test_force_refresh_cancels_inflight(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-a", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            await mgr.get_token()
            mock_token_endpoint.return_value = httpx.Response(
                200, json={"token": "jwt-b", "expiresIn": 300}
            )
            token = await mgr.force_refresh()
            assert token == "jwt-b"
        finally:
            mgr.destroy()

    async def test_force_refresh_cancels_inflight_cancelled_error(self, mock_token_endpoint):
        async def slow():
            await asyncio.sleep(3600)

        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            mgr._inflight = asyncio.create_task(slow())
            mock_token_endpoint.return_value = httpx.Response(
                200, json={"token": "jwt-new", "expiresIn": 300}
            )
            token = await mgr.force_refresh()
            assert token == "jwt-new"
        finally:
            mgr.destroy()

    async def test_force_refresh_cancels_inflight_with_error(self, mock_token_endpoint):
        class _RaisingInflight:
            def done(self) -> bool:
                return False

            def cancel(self) -> None:
                return None

            def __await__(self):
                raise RuntimeError("exchange interrupted")

        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            mgr._inflight = _RaisingInflight()
            mock_token_endpoint.return_value = httpx.Response(
                200, json={"token": "jwt-new", "expiresIn": 300}
            )
            token = await mgr.force_refresh()
            assert token == "jwt-new"
        finally:
            mgr.destroy()

    async def test_background_refresh_failure_logged(self, mock_token_endpoint, caplog):
        mock_token_endpoint.return_value = httpx.Response(
            200, json={"token": "jwt-bg", "expiresIn": 300}
        )
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            with patch("causet_sdk.token_manager.asyncio.sleep", new_callable=AsyncMock):
                await mgr.get_token()
                mock_token_endpoint.return_value = httpx.Response(401, json={"error": "bad"})
                assert mgr._refresh_task is not None
                with caplog.at_level("WARNING"):
                    await mgr._refresh_task
                assert "Background token refresh failed" in caplog.text
        finally:
            mgr.destroy()

    async def test_non_200_empty_body_error(self, mock_token_endpoint):
        mock_token_endpoint.return_value = httpx.Response(403, content=b"")
        mgr = ApiKeyTokenManager(API_URL, API_KEY)
        try:
            with pytest.raises(CausetAuthError, match="403"):
                await mgr.get_token()
        finally:
            mgr.destroy()
