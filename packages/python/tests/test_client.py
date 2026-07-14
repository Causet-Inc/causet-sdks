import base64
import json

import httpx
import pytest
import respx
from unittest.mock import AsyncMock, MagicMock, patch

from causet_sdk.client import CausetClient, _org_id_from_token
from causet_sdk.errors import CausetApiError, CausetError

BASE = "https://api.causet.cloud"
PREFIX = f"{BASE}/v1/platforms/org1/applications/app1"
RUNTIME_PREFIX = f"{BASE}/v1/runtime/platforms/org1/applications/app1"
STREAM_SSE_URL = f"{BASE}/v1/runtime/stream/platforms/org1/applications/app1/intents/submit"
TOKEN_URL = f"{BASE}/v1/token"


def _make_client(**overrides) -> CausetClient:
    defaults = {
        "api_url": BASE,
        "platform_slug": "org1",
        "app_slug": "app1",
        "bearer_token": "jwt-test",
    }
    return CausetClient(**{**defaults, **overrides})


class TestDeriveWsUrl:
    def test_https_to_wss(self):
        c = _make_client(api_url="https://api.example.com")
        assert c._config.ws_url == "wss://api.example.com/ws"

    def test_http_to_ws(self):
        c = _make_client(api_url="http://localhost:8085")
        assert c._config.ws_url == "ws://localhost:8081/ws"

    def test_explicit_ws_url(self):
        c = _make_client(ws_url="wss://custom.ws/ws")
        assert c._config.ws_url == "wss://custom.ws/ws"

    def test_other_scheme_appends_ws(self):
        c = _make_client(api_url="custom://host")
        assert c._config.ws_url == "custom://host/ws"


class TestOrgIdFromToken:
    def test_extracts_org_id(self):
        payload = base64.urlsafe_b64encode(json.dumps({"org_id": "org-99"}).encode()).decode().rstrip("=")
        token = f"hdr.{payload}.sig"
        assert _org_id_from_token(token) == "org-99"

    def test_invalid_token_returns_none(self):
        assert _org_id_from_token("not-a-jwt") is None
        assert _org_id_from_token("a.b") is None


class TestAuthHelpers:
    async def test_get_token_with_bearer(self):
        client = _make_client(bearer_token="my-jwt")
        assert await client.get_token() == "my-jwt"

    async def test_get_token_raises_without_credentials(self):
        client = _make_client(bearer_token="")
        with pytest.raises(CausetError, match="No Causet token"):
            await client.get_token()

    async def test_get_realtime_ids_from_jwt(self):
        payload = base64.urlsafe_b64encode(json.dumps({"org_id": "proj-from-jwt"}).encode()).decode().rstrip("=")
        token = f"hdr.{payload}.sig"
        client = _make_client(bearer_token=token)
        ids = await client.get_realtime_ids()
        assert ids == {"project_id": "proj-from-jwt", "env": "main"}

    async def test_get_realtime_ids_falls_back_to_platform_slug(self):
        client = _make_client(bearer_token="bad.token")
        ids = await client.get_realtime_ids()
        assert ids["project_id"] == "org1"

    async def test_init_and_destroy_with_api_key(self):
        with respx.mock:
            respx.post(TOKEN_URL).return_value = httpx.Response(
                200, json={"token": "jwt-key", "expiresIn": 300}
            )
            client = _make_client(bearer_token="", api_key="ck_test.key")
            await client.init()
            assert await client.get_token() == "jwt-key"
            client.destroy()

    def test_update_config(self):
        client = _make_client()
        client.update_config(bearer_token="new-jwt", fork_id="dev")
        assert client._config.bearer_token == "new-jwt"
        assert client._config.fork_id == "dev"
        client.update_config(unknown_field="ignored")


class TestTokenRetry:
    async def test_retries_on_401_with_api_key(self):
        with respx.mock:
            respx.post(TOKEN_URL).mock(
                side_effect=[
                    httpx.Response(200, json={"token": "jwt-old", "expiresIn": 300}),
                    httpx.Response(200, json={"token": "jwt-new", "expiresIn": 300}),
                ]
            )
            state_route = respx.get(f"{PREFIX}/entities/s/e/state")
            state_route.side_effect = [
                httpx.Response(401, json={"error": "expired"}),
                httpx.Response(200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}),
            ]
            client = _make_client(bearer_token="", api_key="ck_test.key")
            result = await client.fetch_state("s", "e")
            assert result["state"] == {"x": 1}
            assert state_route.call_count == 2

    async def test_401_without_token_manager_reraises(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                401, json={"error": "unauthorized"}
            )
            client = _make_client()
            with pytest.raises(CausetApiError) as exc:
                await client.fetch_state("s", "e")
            assert exc.value.status_code == 401


class TestSubscribeAndGetState:
    async def test_subscribe_fetches_state(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": {"total": 100}, "snapshotVersion": 5},
            )
            client = _make_client()
            await client.subscribe("orders", "order-1")
            state = client.get_state("orders", "order-1")
            assert state == {"total": 100}

    async def test_get_state_returns_none_when_not_subscribed(self):
        client = _make_client()
        assert client.get_state("nope", "nope") is None

    async def test_subscribe_emits_state_event(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": {"total": 100}, "snapshotVersion": 5},
            )
            client = _make_client()
            received = []
            client.on("state", lambda data: received.append(data))
            await client.subscribe("orders", "order-1")
            assert len(received) == 1
            assert received[0]["state"] == {"total": 100}

    async def test_unsubscribe_removes_state(self):
        with respx.mock:
            url = f"{PREFIX}/entities/orders/order-1/state"
            respx.get(url).return_value = httpx.Response(
                200,
                json={"snapshotJson": {"total": 100}, "snapshotVersion": 5},
            )
            client = _make_client()
            await client.subscribe("orders", "order-1")
            client.unsubscribe("orders", "order-1")
            assert client.get_state("orders", "order-1") is None


class TestGetStateReturnsDeepClone:
    async def test_mutation_does_not_affect_internal(self):
        with respx.mock:
            url = f"{PREFIX}/entities/s/e/state"
            respx.get(url).return_value = httpx.Response(
                200, json={"snapshotJson": {"items": [1]}, "snapshotVersion": 1}
            )
            client = _make_client()
            await client.subscribe("s", "e")
            state = client.get_state("s", "e")
            state["items"].append(999)
            assert client.get_state("s", "e") == {"items": [1]}


class TestEmitIntent:
    async def test_emit_accepted_applies_patch(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}
            )
            respx.post(f"{RUNTIME_PREFIX}/intents/submit").return_value = httpx.Response(
                200,
                json={
                    "accepted": True,
                    "executionId": "exec-1",
                    "statePatch": [{"op": "replace", "path": "/x", "value": 2}],
                },
            )
            client = _make_client()
            await client.subscribe("s", "e")
            result = await client.emit("s", "e", "UPDATE", {"x": 2})
            assert result["accepted"] is True
            assert client.get_state("s", "e") == {"x": 2}

    async def test_emit_without_patch_refetches(self):
        with respx.mock:
            state_route = respx.get(f"{PREFIX}/entities/s/e/state")
            state_route.side_effect = [
                httpx.Response(200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}),
                httpx.Response(200, json={"snapshotJson": {"x": 99}, "snapshotVersion": 2}),
            ]
            respx.post(f"{RUNTIME_PREFIX}/intents/submit").return_value = httpx.Response(
                200, json={"accepted": True}
            )
            client = _make_client()
            await client.subscribe("s", "e")
            await client.emit("s", "e", "UPDATE", {})
            assert client.get_state("s", "e") == {"x": 99}
            assert state_route.call_count == 2

    async def test_emit_applies_string_state_patch(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}
            )
            patch_json = json.dumps([{"op": "replace", "path": "/x", "value": 5}])
            respx.post(f"{RUNTIME_PREFIX}/intents/submit").return_value = httpx.Response(
                200, json={"accepted": True, "statePatch": patch_json}
            )
            client = _make_client()
            await client.subscribe("s", "e")
            await client.emit("s", "e", "T", {})
            assert client.get_state("s", "e") == {"x": 5}


class TestEmitStream:
    async def test_emit_stream_invokes_sse_callback(self):
        sse = 'event: progress\ndata: {"step":1}\n\n'
        received: list[dict] = []
        with respx.mock:
            respx.post(STREAM_SSE_URL).return_value = httpx.Response(200, text=sse)
            client = _make_client()
            await client.emit_stream("s", "e", "T", {"k": "v"}, lambda ev: received.append(ev))
        assert len(received) == 1
        assert received[0]["data"] == {"step": 1}

    async def test_emit_stream_with_intent_id(self):
        with respx.mock:
            route = respx.post(STREAM_SSE_URL)
            route.return_value = httpx.Response(200, text="")
            client = _make_client()
            await client.emit_stream("s", "e", "T", {}, lambda _ev: None, intent_id="id-1")
            body = json.loads(route.calls[0].request.content.decode())
            assert body["intentId"] == "id-1"


class TestSelectorEntry:
    def test_eq_identity(self):
        from causet_sdk.client import _SelectorEntry

        entry = _SelectorEntry("s", "e", lambda s: s, lambda v: None)
        assert entry == entry
        assert entry != object()


class TestConnectStream:
    @patch("causet_sdk.transport_ws.CausetTransportWebSocket")
    async def test_connect_stream_wires_transport(self, mock_ws_cls):
        mock_transport = AsyncMock()
        mock_transport.connect = AsyncMock(return_value="conn-99")
        mock_ws_cls.return_value = mock_transport
        client = _make_client()
        conn_id = await client.connect_stream("orders", from_cursor=5)
        assert conn_id == "conn-99"
        mock_ws_cls.assert_called_once()
        kwargs = mock_ws_cls.call_args.kwargs
        assert kwargs["stream_id"] == "orders"
        assert kwargs["from_cursor"] == 5
        assert client._stream_transport is mock_transport

    @patch("causet_sdk.transport_ws.CausetTransportWebSocket")
    async def test_connect_stream_replaces_existing(self, mock_ws_cls):
        old = AsyncMock()
        old.disconnect_async = AsyncMock()
        client = _make_client()
        client._stream_transport = old
        mock_transport = AsyncMock()
        mock_transport.connect = AsyncMock(return_value="conn-new")
        mock_ws_cls.return_value = mock_transport
        await client.connect_stream("orders")
        old.disconnect_async.assert_awaited_once()

    @patch("causet_sdk.transport_ws.CausetTransportWebSocket")
    async def test_connect_stream_replaces_existing_sync_disconnect(self, mock_ws_cls):
        old = AsyncMock(spec=[])
        old.disconnect = MagicMock()
        client = _make_client()
        client._stream_transport = old
        mock_transport = AsyncMock()
        mock_transport.connect = AsyncMock(return_value="conn-new")
        mock_ws_cls.return_value = mock_transport
        await client.connect_stream("orders")
        old.disconnect.assert_called_once()

    @patch("causet_sdk.transport_stream_sse.CausetTransportStreamSse")
    async def test_connect_stream_sse_mode(self, mock_sse_cls):
        mock_transport = AsyncMock()
        mock_transport.connect = AsyncMock(return_value="sse-orders")
        mock_sse_cls.return_value = mock_transport
        client = _make_client(stream_transport="sse", realtime_url="http://localhost:8081")
        conn_id = await client.connect_stream("orders", from_cursor=3, transport="sse")
        assert conn_id == "sse-orders"
        mock_sse_cls.assert_called_once()
        kwargs = mock_sse_cls.call_args.kwargs
        assert kwargs["stream_id"] == "orders"
        assert kwargs["from_cursor"] == 3
        assert kwargs["realtime_url"] == "http://localhost:8081"
        assert client._stream_transport is mock_transport

    @patch("causet_sdk.transport_ws.CausetTransportWebSocket")
    async def test_handle_stream_patch_and_emits(self, mock_ws_cls):
        mock_transport = AsyncMock()
        mock_transport.connect = AsyncMock(return_value="conn-1")
        mock_ws_cls.return_value = mock_transport
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}
            )
            client = _make_client()
            await client.subscribe("s", "e")
            await client.connect_stream("s")
            on_event = mock_ws_cls.call_args.kwargs["on_event"]
            patch_events: list = []
            emit_events: list = []
            client.on("patch_op", lambda d: patch_events.append(d))
            client.on("emitted", lambda d: emit_events.append(d))
            on_event({
                "patch": [{"op": "replace", "path": "/x", "value": 9}],
                "entity_id": "e",
            })
            on_event({"emits": [{"type": "ORDER_PLACED"}]})
            assert client.get_state("s", "e") == {"x": 9}
            assert len(patch_events) == 1
            assert len(emit_events) == 1

    def test_disconnect_stream(self):
        from unittest.mock import MagicMock

        mock_transport = MagicMock()
        client = _make_client()
        client._stream_transport = mock_transport
        client.disconnect_stream()
        mock_transport.disconnect.assert_called_once()
        assert client._stream_transport is None


class TestSelect:
    async def test_select_fires_on_state_change(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1, "y": 10}, "snapshotVersion": 1}
            )
            respx.post(f"{RUNTIME_PREFIX}/intents/submit").return_value = httpx.Response(
                200,
                json={
                    "accepted": True,
                    "statePatch": [{"op": "replace", "path": "/x", "value": 2}],
                },
            )

            client = _make_client()
            values: list = []
            await client.subscribe("s", "e")
            unsub = client.select("s", "e", lambda s: s["x"], lambda v: values.append(v))
            assert values == [1]
            await client.emit("s", "e", "INC", {})
            assert values == [1, 2]
            unsub()


    async def test_selector_exception_logged_not_raised(self, caplog):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}
            )
            respx.post(f"{RUNTIME_PREFIX}/intents/submit").return_value = httpx.Response(
                200,
                json={
                    "accepted": True,
                    "statePatch": [{"op": "replace", "path": "/x", "value": 2}],
                },
            )
            client = _make_client()
            await client.subscribe("s", "e")
            calls = {"n": 0}

            def flaky_selector(_state):
                calls["n"] += 1
                if calls["n"] > 1:
                    raise ValueError("selector boom")
                return _state["x"]

            client.select("s", "e", flaky_selector, lambda _v: None)
            with caplog.at_level("ERROR"):
                await client.emit("s", "e", "T", {})
            assert "Error in state selector" in caplog.text

    async def test_selector_skips_other_entities(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"x": 1}, "snapshotVersion": 1}
            )
            respx.post(f"{RUNTIME_PREFIX}/intents/submit").return_value = httpx.Response(
                200,
                json={
                    "accepted": True,
                    "statePatch": [{"op": "replace", "path": "/x", "value": 2}],
                },
            )
            client = _make_client()
            await client.subscribe("s", "e")
            other_values: list = []
            client.select("other", "entity", lambda s: s["x"], lambda v: other_values.append(v))
            await client.emit("s", "e", "T", {})
            assert other_values == []

    async def test_notify_selectors_noop_when_unsubscribed(self):
        client = _make_client()
        values: list = []
        client.select("s", "e", lambda s: s.get("x"), lambda v: values.append(v))
        client._notify_selectors("s", "e")
        assert values == []


class TestRunQuery:
    async def test_proxies_to_http(self):
        with respx.mock:
            respx.post(f"{PREFIX}/forks/main/queries/q1/run").return_value = httpx.Response(
                200, json={"items": [{"id": 1}]}
            )
            client = _make_client()
            result = await client.run_query("q1", {"k": "v"}, limit=10)
            assert result["items"] == [{"id": 1}]


class TestListQueriesAndProjections:
    async def test_list_queries(self):
        with respx.mock:
            respx.get(f"{PREFIX}/forks/main/queries/").return_value = httpx.Response(
                200, json=[{"slug": "q1"}]
            )
            client = _make_client()
            assert await client.list_queries() == [{"slug": "q1"}]

    async def test_get_query_definition(self):
        with respx.mock:
            respx.get(f"{PREFIX}/forks/main/queries/q1").return_value = httpx.Response(
                200, json={"slug": "q1"}
            )
            client = _make_client()
            assert (await client.get_query_definition("q1"))["slug"] == "q1"

    async def test_list_projections(self):
        with respx.mock:
            respx.get(f"{PREFIX}/forks/main/projections").return_value = httpx.Response(
                200, json=[{"name": "p1"}]
            )
            client = _make_client()
            assert await client.list_projections() == [{"name": "p1"}]

    async def test_get_projection_schema(self):
        with respx.mock:
            respx.get(f"{PREFIX}/forks/main/projections/p1").return_value = httpx.Response(
                200, json={"name": "p1"}
            )
            client = _make_client()
            assert (await client.get_projection_schema("p1"))["name"] == "p1"


class TestFetchStateAtCursorAndDiff:
    async def test_fetch_state_at_cursor(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state-at-cursor").return_value = httpx.Response(
                200, json={"snapshotJson": {"v": 2}, "snapshotVersion": 10}
            )
            client = _make_client()
            result = await client.fetch_state_at_cursor("s", "e", 10)
            assert result["state"] == {"v": 2}

    async def test_diff_state(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/diff").return_value = httpx.Response(
                200, json={"ops": [{"op": "replace"}]}
            )
            client = _make_client()
            result = await client.diff_state("s", "e", 1, 5)
            assert result["ops"]


class TestFetchState:
    async def test_one_shot_fetch(self):
        with respx.mock:
            respx.get(f"{PREFIX}/entities/s/e/state").return_value = httpx.Response(
                200, json={"snapshotJson": {"a": 1}, "snapshotVersion": 3}
            )
            client = _make_client()
            result = await client.fetch_state("s", "e")
            assert result["state"] == {"a": 1}
            assert result["cursor"] == 3
            assert client.get_state("s", "e") is None


class TestListEntities:
    async def test_proxies_to_http(self):
        with respx.mock:
            respx.get(url__startswith=f"{PREFIX}/entities").return_value = httpx.Response(
                200, json={"entities": [], "total": 0}
            )
            client = _make_client()
            result = await client.list_entities(stream_name="orders")
            assert result["entities"] == []
