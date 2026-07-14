"""Low-level HTTP client for the Causet SaaS REST API.

Mirrors CausetHttpClient.js from the JavaScript SDK. Each function is
a standalone async callable that takes a config dataclass and returns
parsed JSON.
"""

from __future__ import annotations

import json as _json
import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from causet_sdk.errors import CausetApiError
from causet_sdk.intent_id import generate_intent_id
from causet_sdk.query_projection import flatten_projection_items

logger = logging.getLogger(__name__)

# Local / slow Causet stacks can exceed httpx defaults (~5s); intents and queries may run long.
_DEFAULT_HTTPX_TIMEOUT = httpx.Timeout(120.0, connect=20.0)


def _stringify_query_input_value(value: Any) -> str:
    """Coerce a single query input to the string form SaaS expects (Map<String, String>)."""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        return _json.dumps(value, separators=(",", ":"))
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    return str(value)


def stringify_query_input(raw: dict[str, Any] | None) -> dict[str, str]:
    """Build ``input`` for ``POST .../queries/{slug}/run`` — all values must be strings.

    Lists/dicts are JSON-encoded (e.g. ``["Pop","Rock"]``). Numbers and booleans use
    string forms aligned with typical ``toString()`` semantics.
    """
    if not raw:
        return {}
    return {k: _stringify_query_input_value(v) for k, v in raw.items()}


@dataclass(frozen=True)
class CausetHttpConfig:
    api_url: str
    platform_slug: str
    app_slug: str
    fork_id: str = "main"
    bearer_token: str = ""


def _base(cfg: CausetHttpConfig) -> str:
    return f"{cfg.api_url.rstrip('/')}/v1/platforms/{cfg.platform_slug}/applications/{cfg.app_slug}"


def _headers(cfg: CausetHttpConfig) -> dict[str, str]:
    h: dict[str, str] = {}
    if cfg.bearer_token:
        h["Authorization"] = f"Bearer {cfg.bearer_token}"
    return h


def _parse_snapshot(data: dict) -> dict[str, Any]:
    """Extract state and cursor from an entity state response."""
    state: Any = data
    raw = data.get("snapshotJson")
    if raw is not None:
        if isinstance(raw, str):
            try:
                state = _json.loads(raw)
            except _json.JSONDecodeError:
                state = data
        else:
            state = raw
    cursor = data.get("snapshotVersion") or data.get("watermark") or 0
    return {"state": state, "cursor": cursor}


async def _request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    json: Any = None,
    params: dict[str, str] | None = None,
    allow_404: bool = False,
) -> Any:
    async with httpx.AsyncClient(timeout=_DEFAULT_HTTPX_TIMEOUT) as client:
        resp = await client.request(method, url, headers=headers, json=json, params=params)

    if allow_404 and resp.status_code == 404:
        return None

    if resp.status_code < 200 or resp.status_code >= 300:
        try:
            body = resp.json()
        except Exception:
            body = {}
        msg = body.get("error") or body.get("message") or resp.reason_phrase or "Request failed"
        raise CausetApiError(resp.status_code, msg, body)

    text = (resp.text or "").strip()
    logger.info("causet_http response url=%s status=%s text=%s", url, resp.status_code, text)
    if not text:
        if (
            method == "POST"
            and "/queries/" in url
            and url.rstrip("/").endswith("/run")
        ):
            logger.warning("causet_http 200_empty_body url=%s", url)
        return {}
    try:
        parsed: Any = _json.loads(text)
    except _json.JSONDecodeError:
        logger.warning(
            "causet_http invalid_json url=%s text=%s",
            url,
            text[:4000],
        )
        raise CausetApiError(
            resp.status_code,
            "Invalid JSON in response",
            {"raw": text[:2000]},
        ) from None

    if (
        isinstance(parsed, dict)
        and method == "POST"
        and "/queries/" in url
        and url.rstrip("/").endswith("/run")
    ):
        has_nonempty_rows = any(
            isinstance(parsed.get(k), list) and len(parsed[k]) > 0
            for k in ("items", "data", "rows", "results")
        )
        if not has_nonempty_rows:
            _max = 16_384
            blob = text if len(text) <= _max else text[:_max] + "\n... [causet body truncated]"
            logger.warning(
                "causet_query_http_response_no_nonempty_row_list url=%s keys=%s body=%s",
                url,
                list(parsed.keys()),
                blob,
            )

    return parsed


async def fetch_state(
    cfg: CausetHttpConfig,
    stream_id: str,
    entity_id: str,
) -> dict[str, Any]:
    """GET .../entities/{stream}/{entity}/state?forkId=..."""
    url = f"{_base(cfg)}/entities/{stream_id}/{entity_id}/state"
    data = await _request(
        "GET", url, headers=_headers(cfg), params={"forkId": cfg.fork_id}, allow_404=True
    )
    if data is None:
        return {"state": None, "cursor": 0}
    return _parse_snapshot(data)


async def fetch_state_at_cursor(
    cfg: CausetHttpConfig,
    stream_id: str,
    entity_id: str,
    cursor: int,
) -> dict[str, Any]:
    """GET .../entities/{stream}/{entity}/state-at-cursor?forkId=...&cursor=..."""
    url = f"{_base(cfg)}/entities/{stream_id}/{entity_id}/state-at-cursor"
    data = await _request(
        "GET",
        url,
        headers=_headers(cfg),
        params={"forkId": cfg.fork_id, "cursor": str(cursor)},
        allow_404=True,
    )
    if data is None:
        return {"state": None, "cursor": 0}
    return _parse_snapshot(data)


async def diff_state(
    cfg: CausetHttpConfig,
    stream_id: str,
    entity_id: str,
    cursor_a: int,
    cursor_b: int,
) -> Any:
    """GET .../entities/{stream}/{entity}/diff?forkId=...&cursorA=...&cursorB=..."""
    url = f"{_base(cfg)}/entities/{stream_id}/{entity_id}/diff"
    return await _request(
        "GET",
        url,
        headers=_headers(cfg),
        params={
            "forkId": cfg.fork_id,
            "cursorA": str(cursor_a),
            "cursorB": str(cursor_b),
        },
    )


async def emit_intent(
    cfg: CausetHttpConfig,
    stream_id: str,
    entity_id: str,
    intent_type: str,
    payload: dict,
    intent_id: str | None = None,
) -> dict[str, Any]:
    """POST .../runtime/.../intents/submit (API key / SDK path)."""
    root = cfg.api_url.rstrip("/")
    url = (
        f"{root}/v1/runtime/platforms/{cfg.platform_slug}/applications/"
        f"{cfg.app_slug}/intents/submit"
    )
    body: dict[str, Any] = {
        "intentId": (intent_id or "").strip() or generate_intent_id(),
        "forkId": cfg.fork_id,
        "streamId": stream_id,
        "entityId": entity_id,
        "intentType": intent_type,
        "payload": payload,
    }

    hdrs = {**_headers(cfg), "Content-Type": "application/json"}
    data = await _request("POST", url, headers=hdrs, json=body)
    return {
        "accepted": data.get("accepted", False),
        "execution_id": data.get("executionId"),
        "error": data.get("error"),
        "state_patch": data.get("statePatch"),
    }


async def run_query(
    cfg: CausetHttpConfig,
    query_slug: str,
    input: dict | None = None,
    *,
    limit: int | None = None,
    offset: int | None = None,
    cursor: str | None = None,
    include_total: bool = False,
) -> dict[str, Any]:
    """POST ``.../forks/{forkId}/queries/{querySlug}/run`` (SaaS query proxy).

    Mirrors query-service pagination (same semantics as e.g.
    ``GET .../q/{slug}?input.query=...&limit=...&offset=...&include_total=...``).

    **Request body**

    - ``input``: named DSL parameters. Values are **stringified** before send (SaaS builds
      ``Map<String,String>``). Pass Python ``list`` / ``dict`` for array/object params —
      they are JSON-encoded (e.g. ``genres`` → ``'["Pop","Rock"]'``). This is **independent**
      of the top-level pagination fields below.
    - ``limit``: optional **page size** for the HTTP/query layer (replaces DSL ``limit`` at
      runtime when the service applies it). Typical range **1–100** (service default often 30).
      Not the same as ``input["limit"]`` when your DSL defines a parameter called ``limit``.
    - ``offset``: optional **SQL OFFSET** — rows to skip (e.g. page 2 with ``limit=30`` →
      ``offset=30``). **Omitted when ``cursor`` is set**; the service ignores ``offset`` in
      that case (keyset pagination wins). **Omitted when ``offset`` is 0** (matches the
      query run API shape; some services treat ``offset: 0`` differently from a missing key).
    - ``cursor``: optional keyset cursor from the previous response's ``next_cursor``.
    - ``include_total``: when true, response may include ``total_count`` (``COUNT(*)`` with
      the same filters).

    **Successful response (JSON)** — shape from the query service, plus SaaS fields:

    - ``items``: row maps (primary result rows).
    - ``next_cursor``: next page cursor or null.
    - ``total_count``: when ``include_total`` was used and supported.
    - ``meta``: e.g. ``{ "cu_used", "rows_scanned", "rows_returned" }`` when present.
    - ``platform``, ``application``: slug strings added by SaaS.

    Errors: ``503`` if query service not configured; ``404`` if app not found; ``500`` for
    other proxy failures; query-service validation errors are forwarded as that service returns.
    """
    url = f"{_base(cfg)}/forks/{cfg.fork_id}/queries/{quote(query_slug, safe='')}/run"
    body: dict[str, Any] = {"input": stringify_query_input(input)}
    if limit is not None:
        body["limit"] = limit
    if cursor is not None:
        body["cursor"] = cursor
    elif offset is not None:
        off = max(0, int(offset))
        if off > 0:
            body["offset"] = off
    if include_total:
        body["include_total"] = True

    hdrs = {**_headers(cfg), "Content-Type": "application/json"}
    data = await _request("POST", url, headers=hdrs, json=body)
    items = data.get("items")
    if isinstance(items, list):
        return {**data, "items": flatten_projection_items(items)}
    return data


async def list_queries(cfg: CausetHttpConfig) -> list[dict]:
    """GET .../forks/{fork}/queries/"""
    url = f"{_base(cfg)}/forks/{cfg.fork_id}/queries/"
    return await _request("GET", url, headers=_headers(cfg))


async def get_query_definition(cfg: CausetHttpConfig, query_slug: str) -> dict:
    """GET .../forks/{fork}/queries/{slug}"""
    url = f"{_base(cfg)}/forks/{cfg.fork_id}/queries/{quote(query_slug, safe='')}"
    return await _request("GET", url, headers=_headers(cfg))


async def list_projections(cfg: CausetHttpConfig) -> list[dict]:
    """GET .../forks/{fork}/projections"""
    url = f"{_base(cfg)}/forks/{cfg.fork_id}/projections"
    return await _request("GET", url, headers=_headers(cfg))


async def get_projection_schema(cfg: CausetHttpConfig, projection_slug: str) -> dict:
    """GET .../forks/{fork}/projections/{slug}"""
    url = f"{_base(cfg)}/forks/{cfg.fork_id}/projections/{quote(projection_slug, safe='')}"
    return await _request("GET", url, headers=_headers(cfg))


async def list_entities(
    cfg: CausetHttpConfig,
    *,
    stream_name: str | None = None,
    search_prefix: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """GET .../entities?forkId=...&streamName=...&..."""
    url = f"{_base(cfg)}/entities"
    params: dict[str, str] = {"forkId": cfg.fork_id}
    if stream_name:
        params["streamName"] = stream_name
    if search_prefix:
        params["searchPrefix"] = search_prefix
    if cursor:
        params["cursor"] = cursor
    if limit is not None:
        params["limit"] = str(limit)
    return await _request("GET", url, headers=_headers(cfg), params=params)
