"""Normalize Causet query-service row keys to match projection table column names.

The query service returns joined rows with dotted keys such as
``artist_directory.artist_id`` and ``show_directory.show_id``. API consumers and
UIs expect bare column names (``artist_id``, ``show_id``) aligned with IR ``fields``.
"""

from __future__ import annotations

from typing import Any

_JOIN_TABLE_KEYS = frozenset(
    {"show_experience_detail", "show_experience_comment_detail", "user_profile"}
)


def _expand_nested_projection_dicts(row: dict[str, Any]) -> dict[str, Any]:
    """Promote nested join objects to dotted keys when the query service omits dot notation."""
    if any(isinstance(k, str) and "." in k for k in row):
        return row
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(k, str) and k in _JOIN_TABLE_KEYS and isinstance(v, dict):
            for ck, cv in v.items():
                out[f"{k}.{ck}"] = cv
        else:
            out[k] = v
    return out


def flatten_projection_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map ``projection_table.column`` → ``column`` (segment after the last ``.``).

    Joined rows can collapse two keys to the same short name (e.g. two ``user_id``s).
    Prefer ``show_experience_detail.*`` when present so experience fields win.
    Non-string keys are left unchanged.

    Disambiguation guarantees (see ``users_wishlist`` / ``users_attendees`` joins):

    - ``shows.id`` wins ``id`` (event pk); ``artists.id`` republished by name.
    - ``artists.name`` and ``venues.name`` republished as ``artist_name`` /
      ``venue_name`` so callers don't lose the artist label to a last-wins
      ``name`` collapse.
    - ``artists.image_url`` and ``venues.image_url`` republished as
      ``artist_image_url`` / ``venue_image_url``. When ``shows.display_image_url``
      (or ``shows.image_url``) is present it overrides ``image_url`` so the
      canonical poster wins over the venue/artist photo.
    """
    expanded = _expand_nested_projection_dicts(row)
    show_poster = expanded.get("shows.display_image_url") or expanded.get("shows.image_url")
    out: dict[str, Any] = {}
    by_short: dict[str, list[tuple[str, Any]]] = {}
    for k, v in expanded.items():
        if not isinstance(k, str):
            out[k] = v
            continue
        short = k.rsplit(".", 1)[-1] if "." in k else k
        by_short.setdefault(short, []).append((k, v))
    for short, pairs in by_short.items():
        if len(pairs) == 1:
            out[short] = pairs[0][1]
            continue
        detail_pairs = [(fk, v2) for fk, v2 in pairs if fk.startswith("show_experience_detail.")]
        if detail_pairs:
            out[short] = detail_pairs[-1][1]
            continue
        comment_pairs = [(fk, v2) for fk, v2 in pairs if fk.startswith("show_experience_comment_detail.")]
        if comment_pairs:
            out[short] = comment_pairs[-1][1]
            continue
        # ``shows.id`` and ``artists.id`` both flatten to ``id``. Prefer the show/event pk for
        # ``id`` and republish ``artists.id`` so line-up rows still expose the performing artist.
        if short == "id":
            show_ids = [(fk, v2) for fk, v2 in pairs if fk == "shows.id"]
            artist_ids = [(fk, v2) for fk, v2 in pairs if fk == "artists.id"]
            show_dir_ids = [(fk, v2) for fk, v2 in pairs if fk == "show_directory.id"]
            if show_ids and artist_ids:
                out["id"] = show_ids[-1][1]
                out["artists.id"] = artist_ids[-1][1]
                continue
            if show_ids:
                out[short] = show_ids[-1][1]
                continue
            if show_dir_ids:
                out[short] = show_dir_ids[-1][1]
                continue
        # ``artists.name`` and ``venues.name`` both flatten to ``name`` (and same for
        # ``image_url``). With multiple source tables present, the naive last-wins
        # collapse silently drops the artist label on rails like ``users_wishlist`` /
        # ``users_attendees`` (joins ``shows`` ⨝ ``venues`` ⨝ ``artists``). Republish the
        # disambiguated ``artist_*`` / ``venue_*`` keys so downstream mappers can read
        # them by table without re-parsing dotted names.
        if short == "name":
            artist_pairs = [(fk, v2) for fk, v2 in pairs if fk == "artists.name"]
            venue_pairs = [(fk, v2) for fk, v2 in pairs if fk == "venues.name"]
            if artist_pairs and venue_pairs:
                out.setdefault("artist_name", artist_pairs[-1][1])
                out.setdefault("venue_name", venue_pairs[-1][1])
        elif short == "image_url":
            artist_pairs = [(fk, v2) for fk, v2 in pairs if fk == "artists.image_url"]
            venue_pairs = [(fk, v2) for fk, v2 in pairs if fk == "venues.image_url"]
            if artist_pairs:
                out.setdefault("artist_image_url", artist_pairs[-1][1])
            if venue_pairs:
                out.setdefault("venue_image_url", venue_pairs[-1][1])
        out[short] = pairs[-1][1]
    # Show poster wins over artist/venue photo for the canonical ``image_url``.
    # ``shows.display_image_url`` lives under a non-colliding short
    # (``display_image_url``) so it never enters the by_short loop above.
    if show_poster:
        out["image_url"] = show_poster
    return out


def flatten_projection_items(items: list[Any]) -> list[Any]:
    """Flatten row dicts in a query ``items`` array; pass through non-dicts."""
    out: list[Any] = []
    for r in items:
        if isinstance(r, dict):
            out.append(flatten_projection_row(r))
        else:
            out.append(r)
    return out
