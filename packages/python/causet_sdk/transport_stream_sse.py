"""SSE transport for causet-realtime stream events (replay + live)."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional
from urllib.parse import quote, urlencode

import httpx

from causet_sdk.http_client import CausetHttpConfig
from causet_sdk.realtime import derive_realtime_url
from causet_sdk.transport_sse import parse_sse_chunk

logger = logging.getLogger(__name__)

_SSE_TIMEOUT = httpx.Timeout(None, connect=20.0)


def build_stream_events_url(
    realtime_url: str,
    cfg: CausetHttpConfig,
    *,
    stream_id: str,
    fork_id: Optional[str] = None,
    from_cursor: Optional[int] = None,
    token: Optional[str] = None,
    api_key: Optional[str] = None,
) -> str:
    base = derive_realtime_url(realtime_url)
    fork = fork_id or cfg.fork_id or "main"
    path = (
        f"{base}/v1/platforms/{quote(cfg.platform_slug, safe='')}/applications/"
        f"{quote(cfg.app_slug, safe='')}/streams/{quote(stream_id, safe='')}/events"
    )
    params: dict[str, str] = {"fork_id": fork}
    if from_cursor is not None and from_cursor > 0:
        params["from_cursor"] = str(from_cursor)
    if token:
        params["token"] = token
    if api_key:
        params["api_key"] = api_key
    return f"{path}?{urlencode(params)}"


class CausetTransportStreamSse:
    """One-way SSE stream from causet-realtime."""

    def __init__(
        self,
        realtime_url: str,
        cfg: CausetHttpConfig,
        stream_id: str,
        *,
        fork_id: Optional[str] = None,
        from_cursor: Optional[int] = None,
        api_key: Optional[str] = None,
        on_event: Optional[Callable[[dict[str, Any]], None]] = None,
        on_connected: Optional[Callable[[], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
        on_close: Optional[Callable[[], None]] = None,
    ) -> None:
        self.realtime_url = realtime_url
        self.cfg = cfg
        self.stream_id = stream_id
        self.fork_id = fork_id
        self.from_cursor = from_cursor
        self.api_key = api_key or ""
        self.on_event = on_event or (lambda _: None)
        self.on_connected = on_connected or (lambda: None)
        self.on_error = on_error or (lambda _: None)
        self.on_close = on_close or (lambda: None)
        self.is_connected = False
        self.conn_id: Optional[str] = None
        self._client: Optional[httpx.AsyncClient] = None

    async def connect(self) -> Optional[str]:
        token = self.cfg.bearer_token
        if not token and not self.api_key:
            raise ValueError("Stream SSE requires bearer_token or api_key")

        url = build_stream_events_url(
            self.realtime_url,
            self.cfg,
            stream_id=self.stream_id,
            fork_id=self.fork_id,
            from_cursor=self.from_cursor,
            token=token or None,
            api_key=self.api_key or None,
        )
        headers = {"Accept": "text/event-stream"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        self._client = httpx.AsyncClient(timeout=_SSE_TIMEOUT)
        try:
            async with self._client.stream("GET", url, headers=headers) as resp:
                resp.raise_for_status()
                self.is_connected = True
                self.conn_id = f"sse-{self.stream_id}"
                self.on_connected()
                buffer = ""
                async for chunk in resp.aiter_text():
                    buffer += chunk
                    events, buffer = parse_sse_chunk(buffer)
                    for ev in events:
                        data = ev.get("data")
                        if isinstance(data, dict):
                            self.on_event(data)
        except Exception as exc:
            if self.is_connected:
                self.on_error(exc)
            else:
                raise
        finally:
            self.is_connected = False
            if self._client:
                await self._client.aclose()
                self._client = None
            self.on_close()
        return self.conn_id

    async def disconnect_async(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
        self.is_connected = False
        self.conn_id = None

    def disconnect(self) -> None:
        self.is_connected = False
        self.conn_id = None
