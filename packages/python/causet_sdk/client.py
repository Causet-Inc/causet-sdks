"""CausetClient — main SDK class for the Causet runtime API.

Mirrors CausetClient.js from the JavaScript SDK.  Holds state for
subscribed entities, publishes intents, and manages WebSocket streaming.
"""

from __future__ import annotations

import base64
import copy
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional

from causet_sdk.emitter import Emitter
from causet_sdk.errors import CausetApiError, CausetError
from causet_sdk.http_client import (
    CausetHttpConfig,
    diff_state as _diff_state,
    submit_intent as _submit_intent,
    fetch_state as _fetch_state,
    fetch_state_at_cursor as _fetch_state_at_cursor,
    get_projection_schema as _get_projection_schema,
    get_query_definition as _get_query_definition,
    list_entities as _list_entities,
    list_projections as _list_projections,
    list_queries as _list_queries,
    run_query as _run_query,
)
from causet_sdk.patch import apply_patch
from causet_sdk.token_manager import ApiKeyTokenManager

logger = logging.getLogger(__name__)


def _deep_clone(obj: Any) -> Any:
    return copy.deepcopy(obj)


def _sub_key(stream_id: str, entity_id: str) -> str:
    return f"{stream_id}:{entity_id}"


from causet_sdk.realtime import derive_realtime_url, derive_ws_url


def _org_id_from_token(token: str) -> Optional[str]:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        decoded = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(decoded)
        return payload.get("org_id")
    except Exception:
        return None


StreamTransportMode = Literal["websocket", "sse"]


@dataclass
class _ClientConfig:
    api_url: str
    platform_slug: str
    app_slug: str
    fork_id: str
    ws_url: str
    realtime_url: str
    stream_transport: StreamTransportMode
    bearer_token: str
    api_key: str


class CausetClient:
    """SDK client for the Causet runtime API.

    Holds state only for subscribed entities.  Publishes intents via REST
    and streams real-time events via WebSocket.
    """

    def __init__(
        self,
        api_url: str,
        platform_slug: str,
        app_slug: str,
        fork_id: str = "main",
        ws_url: Optional[str] = None,
        realtime_url: Optional[str] = None,
        stream_transport: StreamTransportMode = "websocket",
        bearer_token: str = "",
        api_key: str = "",
    ) -> None:
        from causet_sdk.realtime import derive_realtime_url

        self._config = _ClientConfig(
            api_url=api_url,
            platform_slug=platform_slug,
            app_slug=app_slug,
            fork_id=fork_id,
            ws_url=ws_url or derive_ws_url(api_url),
            realtime_url=realtime_url or derive_realtime_url(api_url),
            stream_transport=stream_transport,
            bearer_token=bearer_token,
            api_key=api_key,
        )

        self._token_manager: Optional[ApiKeyTokenManager] = (
            ApiKeyTokenManager(api_url, api_key) if api_key else None
        )

        self._subscriptions: dict[str, dict[str, Any]] = {}
        self._emitter = Emitter()
        self._selectors: set[_SelectorEntry] = set()
        self._stream_transport: Any = None

    # ------------------------------------------------------------------
    # Auth helpers
    # ------------------------------------------------------------------

    async def _get_token(self) -> Optional[str]:
        if self._token_manager:
            return await self._token_manager.get_token()
        return self._config.bearer_token or None

    async def get_token(self) -> str:
        """Public token access for adapters and integrations."""
        token = await self._get_token()
        if not token:
            raise CausetError(
                "No Causet token available — set api_key or bearer_token"
            )
        return token

    def _realtime_ids_from_token(self, token: str) -> dict[str, str]:
        org_id = _org_id_from_token(token)
        return {
            "project_id": org_id or self._config.platform_slug,
            "env": self._config.fork_id,
        }

    async def get_realtime_ids(self) -> dict[str, str]:
        """Extract projectId and env from JWT for WebSocket connections."""
        token = await self.get_token()
        return self._realtime_ids_from_token(token)

    def _http_config(self, bearer_token: Optional[str] = None) -> CausetHttpConfig:
        return CausetHttpConfig(
            api_url=self._config.api_url,
            platform_slug=self._config.platform_slug,
            app_slug=self._config.app_slug,
            fork_id=self._config.fork_id,
            bearer_token=bearer_token or "",
        )

    async def _run_with_token_retry(
        self,
        fn: Callable[[CausetHttpConfig], Awaitable[Any]],
    ) -> Any:
        """Run an HTTP helper; on **401**, force a new API-key JWT and retry once."""
        token = await self._get_token()
        try:
            return await fn(self._http_config(token))
        except CausetApiError as e:
            if e.status_code != 401 or self._token_manager is None:
                raise
            await self._token_manager.force_refresh()
            token2 = await self._get_token()
            return await fn(self._http_config(token2))

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def init(self) -> None:
        """Eagerly exchange the API key and begin background refresh."""
        if self._token_manager:
            await self._token_manager.init()

    def destroy(self) -> None:
        """Disconnect stream and stop token refresh."""
        self.disconnect_stream()
        if self._token_manager:
            self._token_manager.destroy()

    # ------------------------------------------------------------------
    # Subscriptions
    # ------------------------------------------------------------------

    async def subscribe(self, stream_id: str, entity_id: str) -> None:
        """Fetch entity state and store it.  Emits ``"state"`` event."""
        result = await self._run_with_token_retry(
            lambda cfg: _fetch_state(cfg, stream_id, entity_id)
        )
        key = _sub_key(stream_id, entity_id)
        self._subscriptions[key] = {
            "state": _deep_clone(result["state"]) if result["state"] else {},
            "cursor": result.get("cursor", 0),
        }
        self._emitter.emit(
            "state",
            {"stream_id": stream_id, "entity_id": entity_id, "state": self.get_state(stream_id, entity_id)},
        )
        self._notify_selectors(stream_id, entity_id)

    def unsubscribe(self, stream_id: str, entity_id: str) -> None:
        """Remove stored state for entity."""
        key = _sub_key(stream_id, entity_id)
        self._subscriptions.pop(key, None)
        self._selectors = {
            e for e in self._selectors
            if not (e.stream_id == stream_id and e.entity_id == entity_id)
        }

    def get_state(self, stream_id: str, entity_id: str) -> Optional[dict]:
        """Return latest stored state (deep clone) or ``None``."""
        sub = self._subscriptions.get(_sub_key(stream_id, entity_id))
        return _deep_clone(sub["state"]) if sub else None

    # ------------------------------------------------------------------
    # Intents
    # ------------------------------------------------------------------

    async def submit_intent(
        self,
        stream_id: str,
        entity_id: str,
        intent_type: str,
        payload: dict,
        intent_id: Optional[str] = None,
    ) -> dict:
        """Submit an intent to the Causet runtime.

        Returns ``{accepted, execution_id?, error?, state_patch?}``. This submits
        an intent for processing; it does not directly append a committed
        business event.
        """
        result = await self._run_with_token_retry(
            lambda cfg: _submit_intent(
                cfg, stream_id, entity_id, intent_type, payload, intent_id
            )
        )

        if result.get("accepted"):
            key = _sub_key(stream_id, entity_id)
            sub = self._subscriptions.get(key)
            if sub:
                patch = result.get("state_patch")
                if patch:
                    ops = json.loads(patch) if isinstance(patch, str) else patch
                    if isinstance(ops, list):
                        apply_patch(sub["state"], ops)
                        self._emitter.emit(
                            "patch_op",
                            {"stream_id": stream_id, "entity_id": entity_id, "ops": ops},
                        )
                else:
                    fresh = await self._run_with_token_retry(
                        lambda cfg: _fetch_state(cfg, stream_id, entity_id)
                    )
                    sub["state"] = _deep_clone(fresh["state"]) if fresh["state"] else {}
                    sub["cursor"] = fresh.get("cursor", 0)

                self._emitter.emit(
                    "state",
                    {
                        "stream_id": stream_id,
                        "entity_id": entity_id,
                        "state": self.get_state(stream_id, entity_id),
                    },
                )
                self._notify_selectors(stream_id, entity_id)

        return result

    async def intent(
        self,
        stream_id: str,
        entity_id: str,
        intent_type: str,
        payload: dict,
        intent_id: Optional[str] = None,
    ) -> dict:
        """Deprecated alias for :meth:`submit_intent`."""
        import warnings

        warnings.warn(
            "intent() is deprecated; use submit_intent(). "
            "This method submits an intent to the runtime; it does not directly "
            "append a committed business event.",
            DeprecationWarning,
            stacklevel=2,
        )
        return await self.submit_intent(
            stream_id, entity_id, intent_type, payload, intent_id
        )

    async def intent_stream(
        self,
        stream_id: str,
        entity_id: str,
        intent_type: str,
        payload: dict,
        on_event: Callable[[dict], None],
        intent_id: Optional[str] = None,
    ) -> None:
        """Submit intent and stream SSE progress events."""
        from causet_sdk.intent_id import generate_intent_id
        from causet_sdk.transport_sse import submit_intent_stream

        token = await self.get_token()
        body: dict[str, Any] = {
            "intentId": (intent_id or "").strip() or generate_intent_id(),
            "forkId": self._config.fork_id,
            "streamId": stream_id,
            "entityId": entity_id,
            "intentType": intent_type,
            "payload": payload,
        }

        async def _run(cfg):
            await submit_intent_stream(cfg, body, on_event)

        await self._run_with_token_retry(_run)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def run_query(
        self,
        query_slug: str,
        input: Optional[dict] = None,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        cursor: Optional[str] = None,
        include_total: bool = False,
    ) -> dict:
        """Run a named query via SaaS ``POST .../queries/{slug}/run``.

        ``input`` values are stringified for the API (lists/dicts become JSON strings).
        The keyword ``limit`` is **pagination page size** for the query HTTP layer, not
        the same as an ``input`` key named ``limit`` in your DSL. Use ``offset`` for
        page-based skips; omit it when using ``cursor`` (keyset). See ``http_client.run_query``.
        """
        return await self._run_with_token_retry(
            lambda cfg: _run_query(
                cfg,
                query_slug,
                input,
                limit=limit,
                offset=offset,
                cursor=cursor,
                include_total=include_total,
            )
        )

    async def list_queries(self) -> list:
        return await self._run_with_token_retry(lambda cfg: _list_queries(cfg))

    async def get_query_definition(self, query_slug: str) -> dict:
        return await self._run_with_token_retry(
            lambda cfg: _get_query_definition(cfg, query_slug)
        )

    # ------------------------------------------------------------------
    # Projections
    # ------------------------------------------------------------------

    async def list_projections(self) -> list:
        return await self._run_with_token_retry(lambda cfg: _list_projections(cfg))

    async def get_projection_schema(self, projection_slug: str) -> dict:
        return await self._run_with_token_retry(
            lambda cfg: _get_projection_schema(cfg, projection_slug)
        )

    # ------------------------------------------------------------------
    # Entities
    # ------------------------------------------------------------------

    async def list_entities(
        self,
        *,
        stream_name: Optional[str] = None,
        search_prefix: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> dict:
        return await self._run_with_token_retry(
            lambda cfg: _list_entities(
                cfg,
                stream_name=stream_name,
                search_prefix=search_prefix,
                cursor=cursor,
                limit=limit,
            )
        )

    async def fetch_state(self, stream_id: str, entity_id: str) -> dict:
        """One-shot fetch without caching."""
        return await self._run_with_token_retry(
            lambda cfg: _fetch_state(cfg, stream_id, entity_id)
        )

    async def fetch_state_at_cursor(
        self, stream_id: str, entity_id: str, cursor: int
    ) -> dict:
        return await self._run_with_token_retry(
            lambda cfg: _fetch_state_at_cursor(cfg, stream_id, entity_id, cursor)
        )

    async def diff_state(
        self, stream_id: str, entity_id: str, cursor_a: int, cursor_b: int
    ) -> dict:
        return await self._run_with_token_retry(
            lambda cfg: _diff_state(cfg, stream_id, entity_id, cursor_a, cursor_b)
        )

    # ------------------------------------------------------------------
    # Real-time streaming
    # ------------------------------------------------------------------

    async def connect_stream(
        self,
        stream_id: str,
        *,
        transport: Optional[StreamTransportMode] = None,
        from_cursor: Optional[int] = None,
        channels: Optional[list[dict[str, str]]] = None,
    ) -> str:
        """Connect to a live stream via WebSocket or SSE.

        Returns connection id (WebSocket ``conn_id`` or ``sse-{stream_id}``).
        """
        mode = transport or self._config.stream_transport

        if self._stream_transport:
            if hasattr(self._stream_transport, "disconnect_async"):
                await self._stream_transport.disconnect_async()
            else:
                self._stream_transport.disconnect()
            self._stream_transport = None

        token = await self.get_token()

        if mode == "sse":
            from causet_sdk.transport_stream_sse import CausetTransportStreamSse

            transport_impl = CausetTransportStreamSse(
                realtime_url=self._config.realtime_url,
                cfg=self._http_config(token),
                stream_id=stream_id,
                fork_id=self._config.fork_id,
                from_cursor=from_cursor,
                api_key=self._config.api_key or None,
                on_event=lambda event: self._handle_stream_event(stream_id, event),
                on_connected=lambda: self._emitter.emit(
                    "stream_connected",
                    {"stream_id": stream_id, "conn_id": f"sse-{stream_id}", "transport": "sse"},
                ),
                on_error=lambda err: self._emitter.emit("error", err),
                on_close=lambda: self._emitter.emit(
                    "stream_disconnected", {"stream_id": stream_id, "transport": "sse"}
                ),
            )
            self._stream_transport = transport_impl
            result = await transport_impl.connect()
            return result or f"sse-{stream_id}"

        from causet_sdk.transport_ws import CausetTransportWebSocket

        transport_impl = CausetTransportWebSocket(
            ws_url=self._config.ws_url,
            stream_id=stream_id,
            fork_id=self._config.fork_id,
            api_key=self._config.api_key or None,
            bearer_token=token,
            channels=channels,
            from_cursor=from_cursor,
            on_event=lambda event: self._handle_stream_event(stream_id, event),
            on_welcome=lambda conn_id: self._emitter.emit(
                "stream_connected",
                {"stream_id": stream_id, "conn_id": conn_id, "transport": "websocket"},
            ),
            on_error=lambda err: self._emitter.emit("error", err),
            on_close=lambda: self._emitter.emit(
                "stream_disconnected", {"stream_id": stream_id, "transport": "websocket"}
            ),
        )
        self._stream_transport = transport_impl
        result = await transport_impl.connect()
        return result or ""

    def disconnect_stream(self) -> None:
        """Disconnect WebSocket."""
        if self._stream_transport:
            self._stream_transport.disconnect()
            self._stream_transport = None

    def _handle_stream_event(self, stream_id: str, event: dict) -> None:
        self._emitter.emit("stream_event", {"stream_id": stream_id, "event": event})

        patch = event.get("patch")
        entity_id = event.get("entity_id")
        if isinstance(patch, list) and entity_id:
            key = _sub_key(stream_id, entity_id)
            sub = self._subscriptions.get(key)
            if sub:
                apply_patch(sub["state"], patch)
                self._emitter.emit(
                    "patch_op",
                    {"stream_id": stream_id, "entity_id": entity_id, "ops": patch},
                )
                self._emitter.emit(
                    "state",
                    {
                        "stream_id": stream_id,
                        "entity_id": entity_id,
                        "state": self.get_state(stream_id, entity_id),
                    },
                )
                self._notify_selectors(stream_id, entity_id)

        emits = event.get("emits")
        if isinstance(emits, list):
            self._emitter.emit(
                "emitted",
                {"stream_id": stream_id, "entity_id": entity_id, "emits": emits},
            )

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def on(self, event_type: str, handler: Callable) -> Callable[[], None]:
        """Register event handler.  Returns unsubscribe callable."""
        return self._emitter.on(event_type, handler)

    # ------------------------------------------------------------------
    # Selectors
    # ------------------------------------------------------------------

    def select(
        self,
        stream_id: str,
        entity_id: str,
        selector: Callable[[dict], Any],
        handler: Callable[[Any], None],
    ) -> Callable[[], None]:
        """Observe derived state. Handler called when selector output changes."""
        entry = _SelectorEntry(stream_id, entity_id, selector, handler)

        state = self.get_state(stream_id, entity_id)
        if state is not None:
            value = selector(state)
            entry.last_value = value
            handler(value)

        self._selectors.add(entry)
        return lambda: self._selectors.discard(entry)

    def _notify_selectors(self, stream_id: str, entity_id: str) -> None:
        state = self.get_state(stream_id, entity_id)
        if state is None:
            return
        for entry in list(self._selectors):
            if entry.stream_id != stream_id or entry.entity_id != entity_id:
                continue
            try:
                new_value = entry.selector(state)
                if json.dumps(new_value, sort_keys=True) != json.dumps(
                    entry.last_value, sort_keys=True
                ):
                    entry.last_value = _deep_clone(new_value)
                    entry.handler(new_value)
            except Exception:
                logger.exception("Error in state selector")

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    def update_config(self, **updates: Any) -> None:
        """Update configuration (e.g. bearer_token)."""
        for k, v in updates.items():
            if hasattr(self._config, k):
                setattr(self._config, k, v)


class _SelectorEntry:
    __slots__ = ("stream_id", "entity_id", "selector", "handler", "last_value")

    def __init__(
        self,
        stream_id: str,
        entity_id: str,
        selector: Callable,
        handler: Callable,
    ) -> None:
        self.stream_id = stream_id
        self.entity_id = entity_id
        self.selector = selector
        self.handler = handler
        self.last_value: Any = None

    def __hash__(self) -> int:
        return id(self)

    def __eq__(self, other: object) -> bool:
        return self is other
