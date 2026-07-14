"""Tests for causet-realtime stream SSE transport."""

from __future__ import annotations

import httpx
import pytest
import respx

from causet_sdk.http_client import CausetHttpConfig
from causet_sdk.transport_stream_sse import (
    CausetTransportStreamSse,
    build_stream_events_url,
)

CFG = CausetHttpConfig(
    api_url="http://localhost:8085",
    platform_slug="org1",
    app_slug="app1",
    fork_id="sandbox",
    bearer_token="jwt-test",
)


class TestBuildStreamEventsUrl:
    def test_builds_url_with_fork_and_cursor(self):
        url = build_stream_events_url(
            "http://localhost:8081",
            CFG,
            stream_id="wallet_stream",
            fork_id="sandbox",
            from_cursor=42,
            token="jwt-test",
        )
        assert "http://localhost:8081/v1/platforms/org1/applications/app1/streams/wallet_stream/events" in url
        assert "fork_id=sandbox" in url
        assert "from_cursor=42" in url
        assert "token=jwt-test" in url

    def test_api_key_query_param(self):
        url = build_stream_events_url(
            "http://localhost:8081",
            CFG,
            stream_id="s",
            api_key="ck_live_x.y",
        )
        assert "api_key=ck_live_x.y" in url


class TestCausetTransportStreamSse:
    @pytest.mark.asyncio
    async def test_connects_and_parses_events(self):
        sse_body = 'event: message\ndata: {"x": 1}\n\n'
        received: list[dict] = []

        with respx.mock:
            respx.get(url__regex=r".*/streams/wallet_stream/events.*").return_value = httpx.Response(
                200,
                text=sse_body,
                headers={"Content-Type": "text/event-stream"},
            )
            transport = CausetTransportStreamSse(
                "http://localhost:8081",
                CFG,
                "wallet_stream",
                from_cursor=-1,
                on_event=lambda e: received.append(e),
            )
            await transport.connect()

        assert received == [{"x": 1}]
        assert transport.conn_id == "sse-wallet_stream"

    @pytest.mark.asyncio
    async def test_requires_token_or_api_key(self):
        cfg = CausetHttpConfig(
            api_url="http://localhost:8085",
            platform_slug="org1",
            app_slug="app1",
        )
        transport = CausetTransportStreamSse("http://localhost:8081", cfg, "s")
        with pytest.raises(ValueError, match="bearer_token or api_key"):
            await transport.connect()

    @pytest.mark.asyncio
    async def test_non_ok_response_raises(self):
        with respx.mock:
            respx.get(url__regex=r".*/streams/s/events.*").return_value = httpx.Response(
                500, text="nope"
            )
            transport = CausetTransportStreamSse("http://localhost:8081", CFG, "s")
            with pytest.raises(httpx.HTTPStatusError):
                await transport.connect()

    @pytest.mark.asyncio
    async def test_on_error_when_connected(self):
        errors: list[Exception] = []

        async def broken_stream(request: httpx.Request):
            async def gen():
                yield 'data: {"x":1}\n\n'
                raise RuntimeError("stream broke")

            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=gen())

        with respx.mock:
            respx.get(url__regex=r".*/streams/s/events.*").mock(side_effect=broken_stream)
            transport = CausetTransportStreamSse(
                "http://localhost:8081",
                CFG,
                "s",
                on_error=lambda e: errors.append(e),
            )
            await transport.connect()

        assert len(errors) == 1

    @pytest.mark.asyncio
    async def test_disconnect_async_closes_client(self):
        with respx.mock:
            route = respx.get(url__regex=r".*/streams/s/events.*")
            route.return_value = httpx.Response(
                200,
                text='data: {"x":1}\n\n',
                headers={"Content-Type": "text/event-stream"},
            )
            transport = CausetTransportStreamSse("http://localhost:8081", CFG, "s")
            await transport.connect()
            assert transport._client is None
            transport._client = httpx.AsyncClient()
            await transport.disconnect_async()
            assert transport._client is None
            assert transport.is_connected is False

    def test_disconnect_sync(self):
        transport = CausetTransportStreamSse("http://localhost:8081", CFG, "s")
        transport.is_connected = True
        transport.conn_id = "sse-s"
        transport.disconnect()
        assert transport.is_connected is False
        assert transport.conn_id is None
