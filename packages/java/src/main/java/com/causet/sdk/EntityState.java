package com.causet.sdk;

import com.fasterxml.jackson.databind.JsonNode;

/** Result of {@link CausetClient#fetchState}: decoded entity state plus its cursor/version. */
public final class EntityState {
    private final JsonNode state;
    private final long cursor;

    public EntityState(JsonNode state, long cursor) {
        this.state = state;
        this.cursor = cursor;
    }

    public JsonNode getState() {
        return state;
    }

    public long getCursor() {
        return cursor;
    }
}
