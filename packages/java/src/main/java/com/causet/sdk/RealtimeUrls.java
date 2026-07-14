package com.causet.sdk;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class RealtimeUrls {
    private static final Map<String, String> REALTIME_HOST_BY_API = Map.of(
            "sandbox.api.causet.cloud", "sandbox.realtime.causet.cloud",
            "api.causet.cloud", "realtime.causet.cloud"
    );

    private RealtimeUrls() {}

    public static String deriveRealtimeUrl(String apiUrl) {
        String trimmed = apiUrl == null ? "" : apiUrl.replaceAll("/+$", "");
        try {
            URI uri = new URI(trimmed);
            String host = uri.getHost();
            if (host == null) {
                return trimmed;
            }
            String mapped = REALTIME_HOST_BY_API.get(host);
            if (mapped != null) {
                return new URI(uri.getScheme(), null, mapped, uri.getPort(), null, null, null).toString();
            }
            if ("localhost".equals(host) || "127.0.0.1".equals(host)) {
                int port = uri.getPort();
                if (port <= 0 || port == 8085) {
                    port = 8081;
                }
                return new URI(uri.getScheme(), null, host, port, null, null, null).toString();
            }
            if (host.contains(".api.")) {
                String rtHost = host.replace(".api.", ".realtime.");
                return new URI(uri.getScheme(), null, rtHost, uri.getPort(), null, null, null).toString();
            }
        } catch (URISyntaxException ignored) {
            /* fall through */
        }
        return trimmed;
    }

    public static String deriveWsUrl(String apiUrl) {
        return deriveWsUrlFromRealtime(deriveRealtimeUrl(apiUrl));
    }

    public static String deriveWsUrlFromRealtime(String realtimeUrl) {
        String u = realtimeUrl == null ? "" : realtimeUrl.replaceAll("/+$", "");
        if (u.startsWith("https://")) {
            return u.replace("https://", "wss://") + "/ws";
        }
        if (u.startsWith("http://")) {
            return u.replace("http://", "ws://") + "/ws";
        }
        return u + "/ws";
    }

    public static String buildStreamEventsUrl(
            String realtimeUrl,
            CausetConfig cfg,
            String streamId,
            long fromCursor,
            String token,
            String apiKey) {
        String base = deriveRealtimeUrl(realtimeUrl);
        String fork = cfg.forkId == null || cfg.forkId.isBlank() ? "main" : cfg.forkId;
        StringBuilder sb = new StringBuilder();
        sb.append(base)
                .append("/v1/platforms/")
                .append(enc(cfg.platformSlug))
                .append("/applications/")
                .append(enc(cfg.appSlug))
                .append("/streams/")
                .append(enc(streamId))
                .append("/events?fork_id=")
                .append(enc(fork));
        if (fromCursor > 0) {
            sb.append("&from_cursor=").append(fromCursor);
        }
        if (token != null && !token.isBlank()) {
            sb.append("&token=").append(enc(token));
        }
        if (apiKey != null && !apiKey.isBlank()) {
            sb.append("&api_key=").append(enc(apiKey));
        }
        return sb.toString();
    }

    private static String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }
}
