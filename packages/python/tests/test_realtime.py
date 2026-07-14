"""Tests for realtime URL derivation."""

from causet_sdk.realtime import derive_realtime_url, derive_ws_url, derive_ws_url_from_realtime


class TestDeriveRealtimeUrl:
    def test_sandbox_api_host(self):
        assert (
            derive_realtime_url("https://sandbox.api.causet.cloud")
            == "https://sandbox.realtime.causet.cloud"
        )

    def test_production_api_host(self):
        assert derive_realtime_url("https://api.causet.cloud") == "https://realtime.causet.cloud"

    def test_localhost_defaults_to_realtime_port(self):
        assert derive_realtime_url("http://localhost:8085") == "http://localhost:8081"

    def test_localhost_custom_port_preserved(self):
        assert derive_realtime_url("http://localhost:9000") == "http://localhost:9000"

    def test_generic_api_subdomain_swap(self):
        assert (
            derive_realtime_url("https://staging.api.example.com")
            == "https://staging.realtime.example.com"
        )

    def test_unknown_host_returns_trimmed(self):
        assert derive_realtime_url("https://custom.example.com/") == "https://custom.example.com"


class TestDeriveWsUrl:
    def test_from_api_url(self):
        assert derive_ws_url("https://api.causet.cloud") == "wss://realtime.causet.cloud/ws"

    def test_from_realtime_http(self):
        assert derive_ws_url_from_realtime("http://localhost:8081") == "ws://localhost:8081/ws"

    def test_from_realtime_https(self):
        assert derive_ws_url_from_realtime("https://realtime.causet.cloud") == "wss://realtime.causet.cloud/ws"

    def test_other_scheme_appends_ws(self):
        assert derive_ws_url_from_realtime("custom://host") == "custom://host/ws"

    def test_malformed_url_returns_trimmed(self, monkeypatch):
        def boom(_url: str):
            raise ValueError("bad url")

        monkeypatch.setattr("causet_sdk.realtime.urlparse", boom)
        assert derive_realtime_url("https://api.causet.cloud") == "https://api.causet.cloud"
