"""SSE transport for intent submission progress and generic SSE parsing."""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

import httpx

from causet_sdk.http_client import CausetHttpConfig, _headers

_SSE_TIMEOUT = httpx.Timeout(120.0, connect=20.0)


def parse_sse_chunk(buffer: str) -> tuple[list[dict[str, Any]], str]:
    events: list[dict[str, Any]] = []
    blocks = buffer.split("\n\n")
    remainder = blocks.pop() if blocks else ""
    for block in blocks:
        if not block.strip():
            continue
        event_id: Optional[str] = None
        event_type: Optional[str] = None
        data_lines: list[str] = []
        for line in block.split("\n"):
            if line.startswith("id:"):
                event_id = line[3:].strip()
            elif line.startswith("event:"):
                event_type = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            continue
        raw = "\n".join(data_lines)
        try:
            data: Any = json.loads(raw)
        except json.JSONDecodeError:
            data = raw
        events.append({"id": event_id, "event": event_type, "data": data})
    return events, remainder


async def submit_intent_stream(
    cfg: CausetHttpConfig,
    body: dict[str, Any],
    on_event: Callable[[dict[str, Any]], None],
) -> None:
    """Stream intent submission via POST .../runtime/stream/.../intents/submit."""
    root = cfg.api_url.rstrip("/")
    url = (
        f"{root}/v1/runtime/stream/platforms/{cfg.platform_slug}/applications/"
        f"{cfg.app_slug}/intents/submit"
    )
    hdrs = {**_headers(cfg), "Content-Type": "application/json", "Accept": "text/event-stream"}
    async with httpx.AsyncClient(timeout=_SSE_TIMEOUT) as client:
        async with client.stream("POST", url, headers=hdrs, json=body) as resp:
            resp.raise_for_status()
            buffer = ""
            async for chunk in resp.aiter_text():
                buffer += chunk
                events, buffer = parse_sse_chunk(buffer)
                for ev in events:
                    on_event(ev)
