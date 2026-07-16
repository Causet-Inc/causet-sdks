import json
import httpx
import pytest
import respx

from causet_sdk.http_client import (
    CausetHttpConfig,
    fetch_state,
    submit_intent,
    run_query,
    stringify_query_input,
    list_queries,
    get_query_definition,
    list_projections,
    get_projection_schema,
    list_entities,
    fetch_state_at_cursor,
    diff_state,
    _stringify_query_input_value,
)
from causet_sdk.errors import CausetApiError

BASE = "https://api.causet.cloud"
CFG = CausetHttpConfig(
    api_url=BASE,
    platform_slug="org1",
    app_slug="app1",
    fork_id="main",
    bearer_token="jwt-test",
)
PREFIX = f"{BASE}/v1/platforms/org1/applications/app1"
RUNTIME_PREFIX = f"{BASE}/v1/runtime/platforms/org1/applications/app1"


class TestFetchState:
    async def test_returns_parsed_snapshot(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": {"items": [1, 2]}, "snapshotVersion": 42},
            )
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["state"] == {"items": [1, 2]}
            assert result["cursor"] == 42

    async def test_parses_string_snapshot(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={
                    "snapshotJson": '{"items":[1,2]}',
                    "snapshotVersion": 10,
                },
            )
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["state"] == {"items": [1, 2]}

    async def test_404_returns_none_state(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(404)
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["state"] is None
            assert result["cursor"] == 0

    async def test_500_raises(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                500, json={"error": "internal"}
            )
            with pytest.raises(CausetApiError) as exc_info:
                await fetch_state(CFG, "orders", "order-1")
            assert exc_info.value.status_code == 500

    async def test_uses_watermark_cursor(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1}, "watermark": 99},
            )
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["cursor"] == 99

    async def test_invalid_snapshot_json_falls_back_to_raw(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": "{bad json", "snapshotVersion": 1},
            )
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["state"]["snapshotJson"] == "{bad json"

    async def test_dict_snapshot_json(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": {"nested": True}, "snapshotVersion": 2},
            )
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["state"] == {"nested": True}

    async def test_no_snapshot_json_uses_whole_response(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200, json={"field": "value", "snapshotVersion": 3},
            )
            result = await fetch_state(CFG, "orders", "order-1")
            assert result["state"]["field"] == "value"


class TestSubmitIntent:
    async def test_accepted(self):
        with respx.mock:
            url = f"{RUNTIME_PREFIX}/intents/submit"
            respx.post(url).return_value = httpx.Response(
                200,
                json={
                    "accepted": True,
                    "executionId": "exec-1",
                    "statePatch": [{"op": "replace", "path": "/x", "value": 1}],
                },
            )
            result = await submit_intent(
                CFG, "orders", "order-1", "PLACE_ORDER", {"foo": "bar"}
            )
            assert result["accepted"] is True
            assert result["execution_id"] == "exec-1"

    async def test_sends_auth_header(self):
        with respx.mock:
            url = f"{RUNTIME_PREFIX}/intents/submit"
            route = respx.post(url)
            route.return_value = httpx.Response(200, json={"accepted": True})
            await submit_intent(CFG, "s", "e", "T", {})
            req = route.calls[0].request
            assert req.headers["authorization"] == "Bearer jwt-test"

    async def test_sends_intent_id(self):
        with respx.mock:
            route = respx.post(f"{RUNTIME_PREFIX}/intents/submit")
            route.return_value = httpx.Response(200, json={"accepted": True})
            await submit_intent(CFG, "s", "e", "T", {}, intent_id="custom-id")
            body = json.loads(route.calls[0].request.content.decode())
            assert body["intentId"] == "custom-id"

    async def test_generates_intent_id_when_omitted(self):
        with respx.mock:
            route = respx.post(f"{RUNTIME_PREFIX}/intents/submit")
            route.return_value = httpx.Response(200, json={"accepted": True})
            await submit_intent(CFG, "s", "e", "T", {})
            body = json.loads(route.calls[0].request.content.decode())
            assert isinstance(body["intentId"], str)
            assert body["intentId"]


class TestRunQuery:
    async def test_returns_items(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/order_history/run"
            route = respx.post(url)
            route.return_value = httpx.Response(
                200,
                json={"items": [{"id": 1}], "next_cursor": "abc"},
            )
            result = await run_query(
                CFG, "order_history", {"user_id": "u1"}, limit=10
            )
            assert result["items"] == [{"id": 1}]
            assert result["next_cursor"] == "abc"
            body = json.loads(route.calls[0].request.content.decode())
            assert body["input"] == {"user_id": "u1"}
            assert body["limit"] == 10

    async def test_flattens_projection_table_dot_column_keys(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/joined/run"
            route = respx.post(url)
            route.return_value = httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "artist_directory.artist_id": "bruno-mars",
                            "show_directory.show_id": "z7",
                        }
                    ]
                },
            )
            result = await run_query(CFG, "joined", {})
            assert result["items"] == [{"artist_id": "bruno-mars", "show_id": "z7"}]

    async def test_stringifies_non_string_input(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/get_artists_by_genres/run"
            route = respx.post(url)
            route.return_value = httpx.Response(200, json={"items": []})
            await run_query(
                CFG,
                "get_artists_by_genres",
                {"genres": ["Pop", "Rock"], "limit": 50},
                limit=25,
                include_total=True,
            )
            body = json.loads(route.calls[0].request.content.decode())
            assert body["input"]["genres"] == '["Pop","Rock"]'
            assert body["input"]["limit"] == "50"
            assert body["limit"] == 25
            assert body["include_total"] is True

    async def test_offset_in_body_without_cursor(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/search_concerts/run"
            route = respx.post(url)
            route.return_value = httpx.Response(200, json={"items": [], "total_count": 42})
            await run_query(
                CFG,
                "search_concerts",
                {"query": "Future"},
                limit=30,
                offset=30,
                include_total=True,
            )
            body = json.loads(route.calls[0].request.content.decode())
            assert body["input"]["query"] == "Future"
            assert body["limit"] == 30
            assert body["offset"] == 30
            assert body["include_total"] is True
            assert "cursor" not in body

    async def test_offset_zero_omitted_from_body(self):
        """Match Causet SaaS query/run shape: first page sends no ``offset`` key (not ``0``)."""
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/get_artists/run"
            route = respx.post(url)
            route.return_value = httpx.Response(200, json={"items": []})
            await run_query(
                CFG,
                "get_artists",
                {},
                limit=50,
                offset=0,
                include_total=True,
            )
            body = json.loads(route.calls[0].request.content.decode())
            assert body["input"] == {}
            assert body["limit"] == 50
            assert body["include_total"] is True
            assert "offset" not in body

    async def test_cursor_omits_offset(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/search_concerts/run"
            route = respx.post(url)
            route.return_value = httpx.Response(200, json={"items": []})
            await run_query(
                CFG,
                "search_concerts",
                {"query": "Future"},
                limit=30,
                offset=999,
                cursor="opaque-next",
            )
            body = json.loads(route.calls[0].request.content.decode())
            assert body["cursor"] == "opaque-next"
            assert "offset" not in body

    async def test_empty_body_returns_empty_dict(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/empty/run"
            respx.post(url).return_value = httpx.Response(200, text="")
            result = await run_query(CFG, "empty", {})
            assert result == {}

    async def test_invalid_json_raises_api_error(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/bad/run"
            respx.post(url).return_value = httpx.Response(200, text="not-json")
            with pytest.raises(CausetApiError, match="Invalid JSON"):
                await run_query(CFG, "bad", {})

    async def test_non_list_items_returned_as_is(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/scalar/run"
            respx.post(url).return_value = httpx.Response(200, json={"items": "scalar"})
            result = await run_query(CFG, "scalar", {})
            assert result["items"] == "scalar"

    async def test_empty_items_logs_warning(self, caplog):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/no_rows/run"
            respx.post(url).return_value = httpx.Response(
                200, json={"items": [], "meta": {"rows_returned": 0}}
            )
            with caplog.at_level("WARNING"):
                result = await run_query(CFG, "no_rows", {})
            assert result["items"] == []
            assert "causet_query_http_response_no_nonempty_row_list" in caplog.text


class TestStringifyQueryInput:
    def test_primitives_and_collections(self):
        assert stringify_query_input(
            {"s": "x", "n": 50, "f": 1.5, "b": True, "g": ["Pop", "Rock"]}
        ) == {
            "s": "x",
            "n": "50",
            "f": "1.5",
            "b": "true",
            "g": '["Pop","Rock"]',
        }

    def test_none_and_integer_float(self):
        assert _stringify_query_input_value(None) == "None"
        assert _stringify_query_input_value(50.0) == "50"
        assert stringify_query_input(None) == {}
        assert stringify_query_input({}) == {}


class TestRequestErrors:
    async def test_non_json_error_body(self):
        with respx.mock:
            url = f"{PREFIX}/entities/s/e/state"
            respx.get(url).return_value = httpx.Response(502, content=b"bad gateway")
            with pytest.raises(CausetApiError) as exc:
                await fetch_state(CFG, "s", "e")
            assert exc.value.status_code == 502


class TestListQueries:
    async def test_returns_list(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/"
            respx.get(url).return_value = httpx.Response(
                200, json=[{"slug": "q1"}]
            )
            result = await list_queries(CFG)
            assert result == [{"slug": "q1"}]


class TestGetQueryDefinition:
    async def test_returns_definition(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/queries/q1"
            respx.get(url).return_value = httpx.Response(
                200, json={"slug": "q1", "fields": []}
            )
            result = await get_query_definition(CFG, "q1")
            assert result["slug"] == "q1"


class TestListProjections:
    async def test_returns_list(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/projections"
            respx.get(url).return_value = httpx.Response(
                200, json=[{"name": "proj1"}]
            )
            result = await list_projections(CFG)
            assert result == [{"name": "proj1"}]


class TestGetProjectionSchema:
    async def test_returns_schema(self):
        with respx.mock:
            url = f"{PREFIX}/forks/main/projections/proj1"
            respx.get(url).return_value = httpx.Response(
                200, json={"name": "proj1", "fields": {}}
            )
            result = await get_projection_schema(CFG, "proj1")
            assert result["name"] == "proj1"


class TestListEntities:
    async def test_returns_entities(self):
        with respx.mock:
            respx.get(url__startswith=f"{PREFIX}/entities").return_value = (
                httpx.Response(
                    200,
                    json={
                        "entities": [{"id": "e1"}],
                        "nextCursor": "c2",
                        "total": 5,
                    },
                )
            )
            result = await list_entities(CFG, stream_name="orders")
            assert len(result["entities"]) == 1

    async def test_passes_all_query_params(self):
        with respx.mock:
            route = respx.get(url__startswith=f"{PREFIX}/entities")
            route.return_value = httpx.Response(200, json={"entities": []})
            await list_entities(
                CFG,
                stream_name="orders",
                search_prefix="ord",
                cursor="c1",
                limit=25,
            )
            params = route.calls[0].request.url.params
            assert params["streamName"] == "orders"
            assert params["searchPrefix"] == "ord"
            assert params["cursor"] == "c1"
            assert params["limit"] == "25"


class TestFetchStateAtCursor:
    async def test_returns_state(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state-at-cursor"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": {"v": 1}, "snapshotVersion": 42},
            )
            result = await fetch_state_at_cursor(CFG, "orders", "order-1", 42)
            assert result["state"] == {"v": 1}

    async def test_404_returns_none_state(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state-at-cursor"
            respx.get(url).return_value = httpx.Response(404)
            result = await fetch_state_at_cursor(CFG, "orders", "order-1", 1)
            assert result["state"] is None
            assert result["cursor"] == 0


class TestDiffState:
    async def test_returns_diff(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/diff"
            respx.get(url).return_value = httpx.Response(
                200, json={"ops": []}
            )
            result = await diff_state(CFG, "orders", "order-1", 10, 20)
            assert result == {"ops": []}
