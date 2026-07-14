"""Tests for CausetTransportWebSocket."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from causet_sdk.transport_ws import CausetTransportWebSocket


def _make_transport(**kwargs) -> CausetTransportWebSocket:
    defaults = {
        "ws_url": "wss://api.example.com/ws",
        "project_id": "org1",
        "env": "prod",
        "stream_id": "orders",
        "bearer_token": "jwt-abc",
    }
    return CausetTransportWebSocket(**{**defaults, **kwargs})


class TestBuildUrl:
    def test_with_api_key(self):
        t = CausetTransportWebSocket(
            ws_url="wss://api.example.com/ws",
            project_id="org1",
            env="prod",
            stream_id="orders",
            api_key="ck_live_test",
        )
        url = t._build_url()
        assert "api_key=ck_live_test" in url
        assert "token=" not in url

    def test_with_bearer_token(self):
        t = CausetTransportWebSocket(
            ws_url="wss://api.example.com/ws",
            project_id="org1",
            env="prod",
            stream_id="orders",
            bearer_token="jwt-abc",
        )
        url = t._build_url()
        assert "token=jwt-abc" in url
        assert "api_key=" not in url

    def test_with_api_key_and_bearer_token(self):
        t = CausetTransportWebSocket(
            ws_url="wss://api.example.com/ws",
            project_id="org1",
            env="prod",
            stream_id="orders",
            api_key="ck_live_test",
            bearer_token="jwt-abc",
        )
        url = t._build_url()
        assert "api_key=ck_live_test" in url
        assert "token=jwt-abc" in url


class TestBuildHello:
    def test_hello_message_shape(self):
        t = CausetTransportWebSocket(
            ws_url="wss://api.example.com/ws",
            project_id="org1",
            env="prod",
            stream_id="orders",
        )
        hello = t._build_hello()
        assert hello["type"] == "hello"
        assert hello["v"] == 1
        assert "project_id" not in hello
        assert "env" not in hello
        assert hello["stream_id"] == "orders"
        assert isinstance(hello["subs"], list)
        assert hello["sdk"]["name"] == "causet-sdk-python"

    def test_hello_with_from_cursor(self):
        t = CausetTransportWebSocket(
            ws_url="wss://api.example.com/ws",
            project_id="org1",
            env="prod",
            stream_id="orders",
            from_cursor=42,
        )
        hello = t._build_hello()
        for sub in hello["subs"]:
            assert sub["from_cursor"] == 42

    def test_default_channels(self):
        t = CausetTransportWebSocket(
            ws_url="wss://api.example.com/ws",
            project_id="org1",
            env="prod",
            stream_id="orders",
        )
        hello = t._build_hello()
        channels = [s["channel"] for s in hello["subs"]]
        assert "ledger" in channels
        assert "state" in channels


class _MockWebSocket:
    """Async iterable mock WebSocket; blocks after initial messages to stay connected."""

    def __init__(self, messages: list[str]) -> None:
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        for msg in messages:
            self._queue.put_nowait(msg)
        self.sent: list[str] = []
        self.closed = False
        self._close_raises = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._queue.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send(self, data: str) -> None:
        self.sent.append(data)

    async def close(self) -> None:
        if self._close_raises:
            raise RuntimeError("close failed")
        self.closed = True


class TestConnect:
    async def test_missing_auth_raises(self):
        t = _make_transport(bearer_token="", api_key="")
        with pytest.raises(ValueError, match="api_key or bearer_token"):
            await t.connect()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_connect_welcome_and_events(self, mock_connect):
        ws = _MockWebSocket([
            json.dumps({"type": "welcome", "conn_id": "conn-42"}),
            json.dumps({"type": "patch", "entity_id": "e1", "patch": []}),
            json.dumps({"type": "pong"}),
        ])
        mock_connect.return_value = ws
        events: list[dict] = []
        welcomes: list[str | None] = []
        t = _make_transport(on_event=lambda e: events.append(e), on_welcome=lambda c: welcomes.append(c))
        conn_id = await t.connect()
        await asyncio.sleep(0.05)
        assert conn_id == "conn-42"
        assert t.is_connected
        assert welcomes == ["conn-42"]
        assert len(events) == 1
        assert events[0]["type"] == "patch"
        hello = json.loads(ws.sent[0])
        assert hello["type"] == "hello"
        await t.disconnect_async()
        assert not t.is_connected

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_malformed_json_skipped(self, mock_connect):
        ws = _MockWebSocket([
            "not-json",
            json.dumps({"type": "welcome", "conn_id": "c1"}),
        ])
        mock_connect.return_value = ws
        t = _make_transport()
        conn_id = await t.connect()
        await asyncio.sleep(0.05)
        assert conn_id == "c1"
        await t.disconnect_async()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_error_message_propagates(self, mock_connect):
        ws = _MockWebSocket([
            json.dumps({"type": "error", "message": "auth failed"}),
        ])
        mock_connect.return_value = ws
        errors: list[Exception] = []
        t = _make_transport(on_error=lambda e: errors.append(e))
        with pytest.raises(Exception, match="auth failed"):
            await t.connect()
        assert len(errors) == 1

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_redirect_reconnects(self, mock_connect):
        ws1 = _MockWebSocket([
            json.dumps({"type": "redirect", "url": "wss://new.example.com/ws"}),
        ])
        ws2 = _MockWebSocket([
            json.dumps({"type": "welcome", "conn_id": "conn-new"}),
        ])
        mock_connect.side_effect = [ws1, ws2]
        t = _make_transport()
        conn_id = await t.connect()
        await asyncio.sleep(0.05)
        assert conn_id == "conn-new"
        assert t.ws_url == "wss://new.example.com/ws"
        await t.disconnect_async()


class TestConnectedOps:
    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_sub_unsub_ping(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        mock_connect.return_value = ws
        t = _make_transport()
        await t.connect()
        await asyncio.sleep(0.05)
        await t.sub("ledger", from_cursor=10)
        await t.unsub("state")
        await t.ping()
        assert json.loads(ws.sent[1]) == {
            "type": "sub",
            "stream_id": "orders",
            "channel": "ledger",
            "from_cursor": 10,
        }
        assert json.loads(ws.sent[2]) == {
            "type": "unsub",
            "stream_id": "orders",
            "channel": "state",
        }
        assert json.loads(ws.sent[3])["type"] == "ping"
        await t.disconnect_async()

    async def test_sub_raises_when_not_connected(self):
        t = _make_transport()
        with pytest.raises(RuntimeError, match="not connected"):
            await t.sub("ledger")
        with pytest.raises(RuntimeError, match="not connected"):
            await t.unsub("ledger")
        with pytest.raises(RuntimeError, match="not connected"):
            await t.ping()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_disconnect_sync_and_async(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        mock_connect.return_value = ws
        closed: list[None] = []
        t = _make_transport(on_close=lambda: closed.append(None))
        await t.connect()
        await asyncio.sleep(0.05)
        t.disconnect()
        assert not t.is_connected
        assert t.conn_id is None

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_listen_exception_calls_on_error(self, mock_connect):
        class _FailingWs(_MockWebSocket):
            def __init__(self) -> None:
                super().__init__([json.dumps({"type": "welcome", "conn_id": "c1"})])
                self._queue.put_nowait(json.dumps({"type": "patch"}))

            async def __anext__(self):
                msg = await super().__anext__()
                if json.loads(msg).get("type") == "patch":
                    raise RuntimeError("connection lost")
                return msg

        ws = _FailingWs()
        mock_connect.return_value = ws
        errors: list[Exception] = []
        t = _make_transport(on_error=lambda e: errors.append(e))
        await t.connect()
        await asyncio.sleep(0.05)
        assert any(isinstance(e, RuntimeError) for e in errors)
        await t.disconnect_async()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_disconnect_async_handles_listen_task_error(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        mock_connect.return_value = ws
        t = _make_transport()
        await t.connect()
        await asyncio.sleep(0.05)
        t._listen_task.cancel()
        await t.disconnect_async()
        assert t._listen_task is None

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_bearer_token_sent_as_header(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        mock_connect.return_value = ws
        t = _make_transport(bearer_token="jwt-header")
        await t.connect()
        await asyncio.sleep(0.05)
        _, kwargs = mock_connect.call_args
        assert kwargs["additional_headers"] == [("Authorization", "Bearer jwt-header")]
        await t.disconnect_async()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_disconnect_async_ws_close_error(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        ws._close_raises = True
        mock_connect.return_value = ws
        t = _make_transport()
        await t.connect()
        await asyncio.sleep(0.05)
        await t.disconnect_async()
        assert not t.is_connected

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_disconnect_sync_with_running_loop(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        mock_connect.return_value = ws
        t = _make_transport()
        await t.connect()
        await asyncio.sleep(0.05)
        t.disconnect()
        assert not t.is_connected

    def test_disconnect_sync_without_running_loop(self):
        import threading

        t = _make_transport()
        t._ws = MagicMock()

        def run_disconnect() -> None:
            t.disconnect()

        thread = threading.Thread(target=run_disconnect)
        thread.start()
        thread.join()
        assert t._ws is None
        assert not t.is_connected

    async def test_sub_without_ws(self):
        t = _make_transport()
        t.is_connected = True
        t._ws = None
        with pytest.raises(RuntimeError, match="not connected"):
            await t.sub("ledger")

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_api_key_only_no_bearer_header(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "welcome", "conn_id": "c1"})])
        mock_connect.return_value = ws
        t = _make_transport(bearer_token="", api_key="ck_test")
        await t.connect()
        await asyncio.sleep(0.05)
        _, kwargs = mock_connect.call_args
        assert kwargs["additional_headers"] is None
        await t.disconnect_async()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_error_with_code_only(self, mock_connect):
        ws = _MockWebSocket([json.dumps({"type": "error", "code": "E001"})])
        mock_connect.return_value = ws
        with pytest.raises(Exception, match="E001"):
            await _make_transport().connect()

    @patch("websockets.connect", new_callable=AsyncMock)
    async def test_listen_fails_before_welcome(self, mock_connect):
        class _FailFirstRead(_MockWebSocket):
            async def __anext__(self):
                raise RuntimeError("fail before welcome")

        mock_connect.return_value = _FailFirstRead([])
        with pytest.raises(RuntimeError, match="fail before welcome"):
            await _make_transport().connect()

    async def test_disconnect_async_listen_task_raises(self, caplog):
        class _RaisingListenTask:
            def done(self) -> bool:
                return False

            def cancel(self) -> None:
                return None

            def __await__(self):
                raise RuntimeError("listen exit error")

        t = _make_transport()
        t._listen_task = _RaisingListenTask()
        with caplog.at_level("DEBUG", logger="causet_sdk.transport_ws"):
            await t.disconnect_async()
        assert t._listen_task is None
        assert "listen task exit" in caplog.text

