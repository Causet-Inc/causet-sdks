"""Event emitter with wildcard support.

Mirrors events/Emitter.js from the JavaScript SDK.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class Emitter:
    """Simple synchronous event emitter with ``*`` wildcard support."""

    def __init__(self) -> None:
        self._handlers: dict[str, set[Callable]] = {}
        self._wildcard_handlers: set[Callable] = set()

    def on(self, event_type: str, handler: Callable) -> Callable[[], None]:
        """Register *handler* for *event_type* (``"*"`` = all).

        Returns an unsubscribe callable.
        """
        if event_type == "*":
            self._wildcard_handlers.add(handler)
            return lambda: self._wildcard_handlers.discard(handler)

        self._handlers.setdefault(event_type, set()).add(handler)

        def _unsub() -> None:
            s = self._handlers.get(event_type)
            if s:
                s.discard(handler)
                if not s:
                    del self._handlers[event_type]

        return _unsub

    def off(self, event_type: str, handler: Callable) -> None:
        """Remove a previously registered handler."""
        if event_type == "*":
            self._wildcard_handlers.discard(handler)
            return
        s = self._handlers.get(event_type)
        if s:
            s.discard(handler)
            if not s:
                del self._handlers[event_type]

    def emit(self, event_type: str, data: Any = None) -> None:
        """Emit *event_type* with *data* to all matching handlers."""
        for handler in list(self._handlers.get(event_type, ())):
            try:
                handler(data)
            except Exception:
                logger.exception("Error in event handler for %s", event_type)

        for handler in list(self._wildcard_handlers):
            try:
                handler(event_type, data)
            except Exception:
                logger.exception("Error in wildcard handler for %s", event_type)
