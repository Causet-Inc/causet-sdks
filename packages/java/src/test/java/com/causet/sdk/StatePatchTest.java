package com.causet.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class StatePatchTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void appliesReplaceAndAdd() throws Exception {
        ObjectNode state = (ObjectNode) MAPPER.readTree("{\"quantity\":10,\"nested\":{\"a\":1}}");
        JsonNode ops = MAPPER.readTree(
                "[{\"op\":\"replace\",\"path\":\"/quantity\",\"value\":95},"
                        + "{\"op\":\"add\",\"path\":\"/nested/b\",\"value\":2}]");
        StatePatch.apply(state, ops);
        assertEquals(95, state.get("quantity").asInt());
        assertEquals(2, state.get("nested").get("b").asInt());
    }

    @Test
    void appliesRemove() throws Exception {
        ObjectNode state = (ObjectNode) MAPPER.readTree("{\"a\":1,\"b\":2}");
        JsonNode ops = MAPPER.readTree("[{\"op\":\"remove\",\"path\":\"/a\"}]");
        StatePatch.apply(state, ops);
        assertFalse(state.has("a"));
        assertEquals(2, state.get("b").asInt());
    }

    @Test
    void ignoresMalformedPath() throws Exception {
        ObjectNode state = (ObjectNode) MAPPER.readTree("{\"a\":1}");
        JsonNode ops = MAPPER.readTree("[{\"op\":\"replace\",\"path\":\"no-leading-slash\",\"value\":99}]");
        StatePatch.apply(state, ops);
        assertEquals(1, state.get("a").asInt());
    }

    @Test
    void ignoresNonArrayOps() {
        ObjectNode state = MAPPER.createObjectNode().put("a", 1);
        StatePatch.apply(state, null);
        StatePatch.apply(state, MAPPER.createObjectNode());
        assertEquals(1, state.get("a").asInt());
    }
}
