package com.causet.sdk;

public class CausetConfig {
    public String apiUrl;
    public String platformSlug;
    public String appSlug;
    public String forkId = "main";
    public String wsUrl;
    public String realtimeUrl;
    public StreamTransport streamTransport = StreamTransport.WEBSOCKET;
    public String bearerToken = "";
    public String apiKey = "";

    public void normalize() {
        if (forkId == null || forkId.isBlank()) {
            forkId = "main";
        }
        if (realtimeUrl == null || realtimeUrl.isBlank()) {
            realtimeUrl = RealtimeUrls.deriveRealtimeUrl(apiUrl);
        }
        if (wsUrl == null || wsUrl.isBlank()) {
            wsUrl = RealtimeUrls.deriveWsUrlFromRealtime(realtimeUrl);
        }
        if (streamTransport == null) {
            streamTransport = StreamTransport.WEBSOCKET;
        }
    }
}
