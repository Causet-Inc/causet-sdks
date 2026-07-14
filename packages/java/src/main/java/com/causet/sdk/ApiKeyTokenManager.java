package com.causet.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public class ApiKeyTokenManager {
    private static final MediaType JSON = MediaType.get("application/json");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final OkHttpClient http;
    private final String apiUrl;
    private final String apiKey;
    private String token;
    private long expiresAtMs;

    public ApiKeyTokenManager(String apiUrl, String apiKey) {
        this.apiUrl = apiUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.http = new OkHttpClient.Builder()
                .callTimeout(Duration.ofSeconds(30))
                .build();
    }

    public synchronized String getToken() throws IOException {
        if (token != null && System.currentTimeMillis() < expiresAtMs - 30_000) {
            return token;
        }
        Request req = new Request.Builder()
                .url(apiUrl + "/v1/token")
                .post(RequestBody.create("", JSON))
                .header("Authorization", "ApiKey " + apiKey)
                .build();
        try (Response resp = http.newCall(req).execute()) {
            if (!resp.isSuccessful()) {
                throw new CausetAuthException("Token exchange failed: " + resp.code());
            }
            JsonNode body = MAPPER.readTree(resp.body().string());
            token = body.path("token").asText(null);
            if (token == null || token.isBlank()) {
                throw new CausetAuthException("Token exchange returned no token");
            }
            int ttl = body.path("expiresIn").asInt(300);
            expiresAtMs = System.currentTimeMillis() + ttl * 1000L;
            return token;
        }
    }
}

class CausetAuthException extends IOException {
    CausetAuthException(String message) {
        super(message);
    }
}

class CausetApiException extends IOException {
    final int statusCode;

    CausetApiException(int statusCode, String message) {
        super(message);
        this.statusCode = statusCode;
    }
}
