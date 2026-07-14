"""WebSocket transport for Causet streaming events.

Mirrors CausetTransportWebSocket.js — implements the causet-realtime
hello/sub protocol for real-time patches and emitted events.

Protocol:
  Client -> Server: { type: "hello", v: 1, stream_id, subs }
  Server -> Client: { type: "welcome", conn_id }
  Server -> Client: raw JSON event objects (patch, emits, metadata)
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

logger = logging.getLogger(__name__)

_SDK_VERSION = "0.1.0"


class CausetTransportWebSocket:
    """WebSocket transport for real-time Causet event streaming."""

    def __init__(
        self,
        ws_url: str,
        stream_id: str,
        *,
        project_id: str = "",
        fork_id: str = "",
        env: str = "",
        api_key: Optional[str] = None,
        bearer_token: Optional[str] = None,
        channels: Optional[list[dict[str, str]]] = None,
        from_cursor: Optional[int] = None,
        on_event: Optional[Callable[[dict], None]] = None,
        on_welcome: Optional[Callable[[Optional[str]], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
        on_close: Optional[Callable[[], None]] = None,
    ) -> None:
        self.ws_url = ws_url
        self.project_id = project_id
        self.fork_id = fork_id or env or "main"
        self.stream_id = stream_id
        self.api_key = api_key or ""
        self.bearer_token = bearer_token or ""
        self.channels = channels or [{"channel": "ledger"}, {"channel": "state"}]
        self.from_cursor = from_cursor

        self.on_event = on_event or (lambda e: None)
        self.on_welcome = on_welcome or (lambda c: None)
        self.on_error = on_error or (lambda e: None)
        self.on_close = on_close or (lambda: None)

        self._ws: Any = None
        self._listen_task: Optional[asyncio.Task] = None
        self.is_connected = False
        self.conn_id: Optional[str] = None

    def _build_url(self) -> str:
        parsed = urlparse(self.ws_url)
        params = parse_qs(parsed.query)
        # Local/dev gateways often require api_key on the WS URL even when JWT is also used.
        if self.api_key:
            params["api_key"] = [self.api_key]
        if self.bearer_token:
            params["token"] = [self.bearer_token]
        flat = {k: v[0] for k, v in params.items()}
        # quote_via=quote avoids '+' → space ambiguity in query values (JWT-safe).
        new_query = urlencode(flat, quote_via=quote)
        return urlunparse(parsed._replace(query=new_query))

    def _build_hello(self) -> dict[str, Any]:
        subs = []
        for ch in self.channels:
            entry = dict(ch)
            if self.from_cursor is not None:
                entry["from_cursor"] = self.from_cursor
            subs.append(entry)

        return {
            "type": "hello",
            "v": 1,
            "stream_id": self.stream_id,
            "fork_id": self.fork_id,
            "subs": subs,
            "sdk": {"name": "causet-sdk-python", "ver": _SDK_VERSION},
        }

    async def connect(self) -> Optional[str]:
        """Open WebSocket, send hello, and return ``conn_id`` on welcome."""
        import websockets

        if not self.api_key and not self.bearer_token:
            raise ValueError(
                "Causet WebSocket requires api_key or bearer_token (JWT from POST /v1/token)"
            )

        url = self._build_url()
        extra_headers: list[tuple[str, str]] = []
        if self.bearer_token:
            extra_headers.append(("Authorization", f"Bearer {self.bearer_token}"))
        self._ws = await websockets.connect(
            url,
            additional_headers=extra_headers if extra_headers else None,
        )

        hello = self._build_hello()
        await self._ws.send(json.dumps(hello))

        welcome_future: asyncio.Future[Optional[str]] = asyncio.get_running_loop().create_future()

        async def _listen() -> None:
            try:
                async for raw in self._ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type")

                    if msg_type == "welcome":
                        self.is_connected = True
                        self.conn_id = msg.get("conn_id")
                        self.on_welcome(self.conn_id)
                        if not welcome_future.done():
                            welcome_future.set_result(self.conn_id)
                        continue

                    if msg_type == "error":
                        err = Exception(msg.get("message") or msg.get("code") or "WebSocket error")
                        self.on_error(err)
                        if not welcome_future.done():
                            welcome_future.set_exception(err)
                        continue

                    if msg_type == "redirect":
                        self.ws_url = msg.get("url", self.ws_url)
                        await self._ws.close()
                        result = await self.connect()
                        if not welcome_future.done():
                            welcome_future.set_result(result)
                        return

                    if msg_type == "pong":
                        continue

                    self.on_event(msg)
            except Exception as exc:
                if not welcome_future.done():
                    welcome_future.set_exception(exc)
                self.on_error(exc)
            finally:
                self.is_connected = False
                self.on_close()

        self._listen_task = asyncio.get_running_loop().create_task(_listen())
        return await welcome_future

    async def sub(self, channel: str, from_cursor: Optional[int] = None) -> None:
        """Subscribe to an additional channel."""
        if not self._ws or not self.is_connected:
            raise RuntimeError("WebSocket not connected")
        msg: dict[str, Any] = {"type": "sub", "stream_id": self.stream_id, "channel": channel}
        if from_cursor is not None:
            msg["from_cursor"] = from_cursor
        await self._ws.send(json.dumps(msg))

    async def unsub(self, channel: str) -> None:
        """Unsubscribe from a channel."""
        if not self._ws or not self.is_connected:
            raise RuntimeError("WebSocket not connected")
        await self._ws.send(json.dumps({
            "type": "unsub",
            "stream_id": self.stream_id,
            "channel": channel,
        }))

    async def ping(self) -> None:
        """Send ping (server responds with pong)."""
        if not self._ws or not self.is_connected:
            raise RuntimeError("WebSocket not connected")
        await self._ws.send(json.dumps({"type": "ping", "ts": asyncio.get_running_loop().time()}))

    async def disconnect_async(self) -> None:
        """Close WebSocket and stop listener (awaitable)."""
        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.debug("listen task exit", exc_info=True)
        self._listen_task = None
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                logger.debug("ws close", exc_info=True)
            self._ws = None
        self.is_connected = False
        self.conn_id = None

    def disconnect(self) -> None:
        """Best-effort sync disconnect (prefer ``disconnect_async`` when in async code)."""
        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
        self._listen_task = None
        if self._ws:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._ws.close())
            except RuntimeError:
                pass
            self._ws = None
        self.is_connected = False
        self.conn_id = None
