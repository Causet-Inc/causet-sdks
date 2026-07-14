from causet_sdk.query_projection import flatten_projection_items, flatten_projection_row


def test_flatten_projection_row_strips_table_prefix():
    row = {
        "artist_directory.artist_id": "bruno-mars",
        "artist_directory.name": "Bruno Mars",
        "show_directory.show_id": "z7",
        "show_directory.venue_city": "New York",
    }
    assert flatten_projection_row(row) == {
        "artist_id": "bruno-mars",
        "name": "Bruno Mars",
        "show_id": "z7",
        "venue_city": "New York",
    }


def test_flatten_projection_row_collision_last_wins():
    row = {"a.x": 1, "b.x": 2}
    assert flatten_projection_row(row) == {"x": 2}


def test_flatten_projection_row_prefers_shows_id_over_artists_id():
    row = {
        "shows.id": 2104,
        "artists.id": 1642,
        "shows.title": "Gorillaz",
    }
    flat = flatten_projection_row(row)
    assert flat["id"] == 2104
    assert flat["artists.id"] == 1642
    assert flat.get("title") == "Gorillaz"


def test_flatten_projection_items():
    assert flatten_projection_items(
        [{"t.a": 1}, "skip", {"b": 2}]
    ) == [{"a": 1}, "skip", {"b": 2}]


def test_flatten_projection_row_disambiguates_artist_and_venue_name():
    """``users_wishlist`` / ``users_attendees`` join ``shows`` ⨝ ``venues`` ⨝ ``artists``.

    Both ``artists.name`` and ``venues.name`` collapse to ``name`` under naive
    last-wins; jamlet-api maps wishlist/attending rows by ``artist_name`` /
    ``venue_name``, so the SDK republishes them so the rail labels survive.
    """
    row = {
        "shows.id": 163,
        "artists.id": 184,
        "artists.name": "Saults",
        "venues.name": "Mercury Lounge - New York",
    }
    flat = flatten_projection_row(row)
    assert flat["artist_name"] == "Saults"
    assert flat["venue_name"] == "Mercury Lounge - New York"


def test_flatten_projection_row_disambiguates_image_url_and_prefers_show_poster():
    """``shows.display_image_url`` is the canonical mobile show poster.

    With ``artists.image_url`` and ``venues.image_url`` also in the row, naive
    flatten leaves a single ``image_url`` (last-wins venue) and drops the show
    poster. We surface table-specific keys and ensure the show poster wins.
    """
    row = {
        "shows.id": 1,
        "shows.display_image_url": "https://example.com/show-poster.jpg",
        "artists.image_url": "https://example.com/artist.jpg",
        "venues.image_url": "https://example.com/venue.jpg",
    }
    flat = flatten_projection_row(row)
    assert flat["image_url"] == "https://example.com/show-poster.jpg"
    assert flat["artist_image_url"] == "https://example.com/artist.jpg"
    assert flat["venue_image_url"] == "https://example.com/venue.jpg"
    assert flat["display_image_url"] == "https://example.com/show-poster.jpg"


def test_flatten_projection_row_does_not_invent_artist_or_venue_keys():
    """Only the wishlist/attending shape (both artist + venue) gets the new keys.

    Queries that only join ``venues`` (e.g. venue detail) should still see
    ``name`` / ``image_url`` flattened as before — no phantom ``artist_*``.
    """
    row = {
        "shows.id": 1,
        "venues.name": "Red Rocks",
        "venues.image_url": "https://example.com/rr.jpg",
    }
    flat = flatten_projection_row(row)
    assert flat.get("artist_name") is None
    assert flat.get("artist_image_url") is None
    assert flat["name"] == "Red Rocks"
    assert flat["image_url"] == "https://example.com/rr.jpg"


def test_expand_nested_projection_dicts():
    row = {
        "show_experience_detail": {"rating": 5, "title": "Great show"},
        "plain": "value",
    }
    flat = flatten_projection_row(row)
    assert flat["rating"] == 5
    assert flat["title"] == "Great show"
    assert flat["plain"] == "value"


def test_flatten_prefers_show_experience_detail_on_collision():
    row = {
        "show_experience_detail.score": 10,
        "other_table.score": 1,
    }
    assert flatten_projection_row(row)["score"] == 10


def test_flatten_prefers_show_experience_comment_detail():
    row = {
        "show_experience_comment_detail.body": "nice",
        "other_table.body": "ignored",
    }
    assert flatten_projection_row(row)["body"] == "nice"


def test_flatten_show_id_only():
    row = {"shows.id": 99, "other.id": 1}
    assert flatten_projection_row(row)["id"] == 99


def test_flatten_show_directory_id():
    row = {"show_directory.id": 7, "other.id": 1}
    assert flatten_projection_row(row)["id"] == 7


def test_flatten_non_string_key_passthrough():
    row = {123: "num-key", "plain": "x"}
    assert flatten_projection_row(row)[123] == "num-key"
