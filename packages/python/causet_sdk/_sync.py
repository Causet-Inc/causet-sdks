"""Synchronous wrapper around CausetClient for simple scripts.

Wraps each async method with ``asyncio.run()``.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Optional

from causet_sdk.client import CausetClient


class CausetClientSync:
    """Synchronous facade over :class:`CausetClient`.

    Every async method on ``CausetClient`` is exposed here as a blocking
    call using ``asyncio.run()``.
    """

    def __init__(self, **kwargs: Any) -> None:
        self._client = CausetClient(**kwargs)

    def _run(self, coro: Any) -> Any:
        return asyncio.run(coro)

    def init(self) -> None:
        self._run(self._client.init())

    def destroy(self) -> None:
        self._client.destroy()

    def subscribe(self, stream_id: str, entity_id: str) -> None:
        self._run(self._client.subscribe(stream_id, entity_id))

    def unsubscribe(self, stream_id: str, entity_id: str) -> None:
        self._client.unsubscribe(stream_id, entity_id)

    def get_state(self, stream_id: str, entity_id: str) -> Optional[dict]:
        return self._client.get_state(stream_id, entity_id)

    def submit_intent(
        self,
        stream_id: str,
        entity_id: str,
        intent_type: str,
        payload: dict,
        intent_id: Optional[str] = None,
    ) -> dict:
        return self._run(
            self._client.submit_intent(
                stream_id, entity_id, intent_type, payload, intent_id
            )
        )

    def intent(
        self,
        stream_id: str,
        entity_id: str,
        intent_type: str,
        payload: dict,
        intent_id: Optional[str] = None,
    ) -> dict:
        import warnings

        warnings.warn(
            "intent() is deprecated; use submit_intent().",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.submit_intent(
            stream_id, entity_id, intent_type, payload, intent_id
        )

    def intent_stream(
        self,
        stream_id: str,
        entity_id: str,
        intent_type: str,
        payload: dict,
        on_event,
        intent_id: Optional[str] = None,
    ) -> None:
        return self._run(
            self._client.intent_stream(
                stream_id, entity_id, intent_type, payload, on_event, intent_id
            )
        )

    def run_query(
        self,
        query_slug: str,
        input: Optional[dict] = None,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        cursor: Optional[str] = None,
        include_total: bool = False,
    ) -> dict:
        return self._run(
            self._client.run_query(
                query_slug,
                input,
                limit=limit,
                offset=offset,
                cursor=cursor,
                include_total=include_total,
            )
        )

    def list_queries(self) -> list:
        return self._run(self._client.list_queries())

    def get_query_definition(self, query_slug: str) -> dict:
        return self._run(self._client.get_query_definition(query_slug))

    def list_projections(self) -> list:
        return self._run(self._client.list_projections())

    def get_projection_schema(self, projection_slug: str) -> dict:
        return self._run(self._client.get_projection_schema(projection_slug))

    def list_entities(self, **kwargs: Any) -> dict:
        return self._run(self._client.list_entities(**kwargs))

    def fetch_state(self, stream_id: str, entity_id: str) -> dict:
        return self._run(self._client.fetch_state(stream_id, entity_id))

    def fetch_state_at_cursor(self, stream_id: str, entity_id: str, cursor: int) -> dict:
        return self._run(self._client.fetch_state_at_cursor(stream_id, entity_id, cursor))

    def diff_state(self, stream_id: str, entity_id: str, cursor_a: int, cursor_b: int) -> dict:
        return self._run(self._client.diff_state(stream_id, entity_id, cursor_a, cursor_b))

    def on(self, event_type: str, handler: Callable) -> Callable[[], None]:
        return self._client.on(event_type, handler)

    def select(
        self,
        stream_id: str,
        entity_id: str,
        selector: Callable[[dict], Any],
        handler: Callable[[Any], None],
    ) -> Callable[[], None]:
        return self._client.select(stream_id, entity_id, selector, handler)
