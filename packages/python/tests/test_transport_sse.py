"""Tests for SSE transport (parse_sse_chunk, submit_intent_stream)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from causet_sdk.http_client import CausetHttpConfig
from causet_sdk.transport_sse import parse_sse_chunk, submit_intent_stream

BASE = "https://api.causet.cloud"
CFG = CausetHttpConfig(
    api_url=BASE,
    platform_slug="org1",
    app_slug="app1",
    fork_id="main",
    bearer_token="jwt-test",
)
STREAM_URL = (
    f"{BASE}/v1/runtime/stream/platforms/org1/applications/app1/intents/submit"
)


class TestParseSseChunk:
    def test_empty_buffer(self):
        events, remainder = parse_sse_chunk("")
        assert events == []
        assert remainder == ""

    def test_single_json_event(self):
        block = 'id: evt-1\nevent: progress\ndata: {"step": 1}\n\n'
        events, remainder = parse_sse_chunk(block)
        assert len(events) == 1
        assert events[0]["id"] == "evt-1"
        assert events[0]["event"] == "progress"
        assert events[0]["data"] == {"step": 1}
        assert remainder == ""

    def test_multiple_events(self):
        buffer = (
            'data: {"a": 1}\n\n'
            'id: 2\ndata: {"b": 2}\n\n'
        )
        events, remainder = parse_sse_chunk(buffer)
        assert len(events) == 2
        assert events[0]["data"] == {"a": 1}
        assert events[1]["id"] == "2"
        assert events[1]["data"] == {"b": 2}
        assert remainder == ""

    def test_incomplete_block_stays_in_remainder(self):
        buffer = 'data: {"done": true}\n\nid: partial\ndata: {"x"'
        events, remainder = parse_sse_chunk(buffer)
        assert len(events) == 1
        assert events[0]["data"] == {"done": True}
        assert remainder == 'id: partial\ndata: {"x"'

    def test_non_json_data_preserved_as_string(self):
        events, _ = parse_sse_chunk("data: not-json\n\n")
        assert events[0]["data"] == "not-json"

    def test_multiline_data_joined(self):
        block = "data: line1\ndata: line2\n\n"
        events, _ = parse_sse_chunk(block)
        assert events[0]["data"] == "line1\nline2"

    def test_empty_block_skipped(self):
        events, remainder = parse_sse_chunk("\n\n\n\n")
        assert events == []
        assert remainder == ""

    def test_block_without_data_lines_skipped(self):
        events, _ = parse_sse_chunk("id: only-id\nevent: ping\n\n")
        assert events == []

    def test_whitespace_only_block_skipped(self):
        events, _ = parse_sse_chunk("   \n\n")
        assert events == []


class TestSubmitIntentStream:
    async def test_streams_sse_events_to_callback(self):
        sse_body = (
            'event: started\ndata: {"phase":"start"}\n\n'
            'event: done\ndata: {"phase":"complete"}\n\n'
        )
        received: list[dict] = []

        with respx.mock:
            route = respx.post(STREAM_URL)
            route.return_value = httpx.Response(
                200,
                text=sse_body,
                headers={"Content-Type": "text/event-stream"},
            )
            await submit_intent_stream(
                CFG,
                {"forkId": "main", "streamId": "s", "entityId": "e", "intentType": "T", "payload": {}},
                lambda ev: received.append(ev),
            )

        assert len(received) == 2
        assert received[0]["event"] == "started"
        assert received[0]["data"] == {"phase": "start"}
        assert received[1]["data"] == {"phase": "complete"}
        req = route.calls[0].request
        assert req.headers["authorization"] == "Bearer jwt-test"
        assert req.headers["accept"] == "text/event-stream"
        assert json.loads(req.content.decode())["intentType"] == "T"

    async def test_raises_on_http_error(self):
        with respx.mock:
            respx.post(STREAM_URL).return_value = httpx.Response(500)
            with pytest.raises(httpx.HTTPStatusError):
                await submit_intent_stream(CFG, {}, lambda ev: None)
