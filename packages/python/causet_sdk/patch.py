"""JSON Pointer get/set and RFC 6902-style patch application.

Mirrors Path.js (getPath, setPath) and the applyPatch helper from
CausetClient.js in the JavaScript reference SDK.
"""

from __future__ import annotations

from typing import Any


def get_path(obj: Any, path: str) -> Any:
    """Resolve a JSON Pointer path (e.g. ``/a/b/c``) against *obj*.

    Returns ``None`` for invalid paths or missing keys.
    """
    if not path or not path.startswith("/"):
        return None

    current = obj
    for key in path[1:].split("/"):
        if current is None or not isinstance(current, (dict, list)):
            return None
        if isinstance(current, list):
            try:
                current = current[int(key)]
            except (ValueError, IndexError):
                return None
        else:
            current = current.get(key)
    return current


def set_path(obj: dict, path: str, value: Any) -> None:
    """Set *value* at *path* inside *obj*, creating intermediate dicts."""
    if not path or not path.startswith("/"):
        return

    keys = path[1:].split("/")
    last_key = keys[-1]
    current = obj
    for key in keys[:-1]:
        child = current.get(key)
        if child is None or not isinstance(child, dict):
            current[key] = {}
        current = current[key]
    current[last_key] = value


def apply_patch(state: dict, ops: list[dict[str, Any]] | None) -> None:
    """Apply RFC 6902-style patch operations in-place."""
    if not isinstance(ops, list):
        return
    for op_obj in ops:
        op_type = op_obj.get("op")
        path = op_obj.get("path", "")
        if not path or not path.startswith("/"):
            continue
        if op_type in ("replace", "add"):
            set_path(state, path, op_obj.get("value"))
        elif op_type == "remove":
            keys = path[1:].split("/")
            last_key = keys.pop()
            parent = get_path(state, "/" + "/".join(keys)) if keys else state
            if isinstance(parent, dict) and last_key in parent:
                del parent[last_key]
