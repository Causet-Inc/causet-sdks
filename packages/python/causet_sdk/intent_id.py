from __future__ import annotations

import uuid


def generate_intent_id() -> str:
    """Return a unique intent id when the caller does not supply one."""
    return str(uuid.uuid4())
