"""Tests for CausetClientSync synchronous wrapper."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from causet_sdk._sync import CausetClientSync


@pytest.fixture
def mock_async_client():
    client = MagicMock()
    client.init = AsyncMock(return_value=None)
    client.subscribe = AsyncMock(return_value=None)
    client.unsubscribe = MagicMock()
    client.get_state = MagicMock(return_value={"x": 1})
    client.emit = AsyncMock(return_value={"accepted": True})
    client.emit_stream = AsyncMock(return_value=None)
    client.run_query = AsyncMock(return_value={"items": []})
    client.list_queries = AsyncMock(return_value=[{"slug": "q1"}])
    client.get_query_definition = AsyncMock(return_value={"slug": "q1"})
    client.list_projections = AsyncMock(return_value=[{"name": "p1"}])
    client.get_projection_schema = AsyncMock(return_value={"name": "p1"})
    client.list_entities = AsyncMock(return_value={"entities": []})
    client.fetch_state = AsyncMock(return_value={"state": {}, "cursor": 0})
    client.fetch_state_at_cursor = AsyncMock(return_value={"state": {}, "cursor": 1})
    client.diff_state = AsyncMock(return_value={"ops": []})
    client.on = MagicMock(return_value=lambda: None)
    client.select = MagicMock(return_value=lambda: None)
    client.destroy = MagicMock()
    return client


class TestCausetClientSync:
    @patch("causet_sdk._sync.CausetClient")
    def test_init_delegates_to_async_client(self, mock_cls):
        mock_cls.return_value = MagicMock()
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        mock_cls.assert_called_once_with(api_url="https://api.test", platform_slug="o", app_slug="a")
        assert sync._client is mock_cls.return_value

    @patch("causet_sdk._sync.CausetClient")
    def test_init_calls_async_init(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        sync.init()
        mock_async_client.init.assert_awaited_once()

    @patch("causet_sdk._sync.CausetClient")
    def test_destroy_calls_async_destroy(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        sync.destroy()
        mock_async_client.destroy.assert_called_once()

    @patch("causet_sdk._sync.CausetClient")
    def test_subscribe_runs_async(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        sync.subscribe("orders", "o-1")
        mock_async_client.subscribe.assert_awaited_once_with("orders", "o-1")

    @patch("causet_sdk._sync.CausetClient")
    def test_unsubscribe_delegates_sync(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        sync.unsubscribe("orders", "o-1")
        mock_async_client.unsubscribe.assert_called_once_with("orders", "o-1")

    @patch("causet_sdk._sync.CausetClient")
    def test_get_state_delegates_sync(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        assert sync.get_state("s", "e") == {"x": 1}

    @patch("causet_sdk._sync.CausetClient")
    def test_emit_runs_async(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        result = sync.emit("s", "e", "T", {"k": "v"}, intent_id="id-1")
        mock_async_client.emit.assert_awaited_once_with("s", "e", "T", {"k": "v"}, "id-1")
        assert result["accepted"] is True

    @patch("causet_sdk._sync.CausetClient")
    def test_emit_stream_runs_async(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        on_event = lambda ev: None
        sync.emit_stream("s", "e", "T", {}, on_event, intent_id="id-1")
        mock_async_client.emit_stream.assert_awaited_once_with(
            "s", "e", "T", {}, on_event, "id-1"
        )

    @patch("causet_sdk._sync.CausetClient")
    def test_run_query_runs_async(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        result = sync.run_query("q1", {"k": "v"}, limit=10, offset=5, cursor="c", include_total=True)
        mock_async_client.run_query.assert_awaited_once_with(
            "q1", {"k": "v"}, limit=10, offset=5, cursor="c", include_total=True
        )
        assert result == {"items": []}

    @patch("causet_sdk._sync.CausetClient")
    def test_query_and_projection_wrappers(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        assert sync.list_queries() == [{"slug": "q1"}]
        assert sync.get_query_definition("q1") == {"slug": "q1"}
        assert sync.list_projections() == [{"name": "p1"}]
        assert sync.get_projection_schema("p1") == {"name": "p1"}

    @patch("causet_sdk._sync.CausetClient")
    def test_entity_and_state_wrappers(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        assert sync.list_entities(stream_name="orders") == {"entities": []}
        assert sync.fetch_state("s", "e") == {"state": {}, "cursor": 0}
        assert sync.fetch_state_at_cursor("s", "e", 1) == {"state": {}, "cursor": 1}
        assert sync.diff_state("s", "e", 1, 2) == {"ops": []}

    @patch("causet_sdk._sync.CausetClient")
    def test_on_and_select_delegates_sync(self, mock_cls, mock_async_client):
        mock_cls.return_value = mock_async_client
        sync = CausetClientSync(api_url="https://api.test", platform_slug="o", app_slug="a")
        handler = lambda x: None
        sync.on("state", handler)
        mock_async_client.on.assert_called_once_with("state", handler)
        selector = lambda s: s["x"]
        sync.select("s", "e", selector, handler)
        mock_async_client.select.assert_called_once_with("s", "e", selector, handler)
