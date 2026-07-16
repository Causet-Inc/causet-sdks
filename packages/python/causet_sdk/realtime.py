"""Realtime URL helpers."""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse

_REALTIME_HOST_BY_API = {
    "sandbox.api.causet.cloud": "sandbox.realtime.causet.cloud",
    "api.causet.cloud": "realtime.causet.cloud",
}


def derive_realtime_url(api_url: str) -> str:
    """Map Causet Cloud gateway URL to realtime HTTP base."""
    trimmed = api_url.rstrip("/")
    try:
        parsed = urlparse(trimmed)
        host = parsed.hostname or ""
        mapped = _REALTIME_HOST_BY_API.get(host)
        if mapped:
            return urlunparse(parsed._replace(netloc=mapped))
        if host in ("localhost", "127.0.0.1"):
            port = "8081" if parsed.port in (None, 8085) else str(parsed.port)
            return urlunparse(parsed._replace(netloc=f"{host}:{port}"))
        if ".api." in host:
            return urlunparse(parsed._replace(netloc=host.replace(".api.", ".realtime.")))
    except Exception:
        pass
    return trimmed


def derive_ws_url(api_url: str) -> str:
    """WebSocket URL from API URL via realtime mapping."""
    return derive_ws_url_from_realtime(derive_realtime_url(api_url))


def derive_ws_url_from_realtime(realtime_url: str) -> str:
    u = realtime_url.rstrip("/")
    if u.startswith("https://"):
        return u.replace("https://", "wss://", 1) + "/ws"
    if u.startswith("http://"):
        return u.replace("http://", "ws://", 1) + "/ws"
    return u + "/ws"
