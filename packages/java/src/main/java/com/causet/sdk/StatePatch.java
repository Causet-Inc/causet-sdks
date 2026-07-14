package com.causet.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Applies RFC 6902-flavored patch ops (op/path/value, as delivered by
 * causet-realtime and the intent-submit response) to a cached entity state
 * tree. Mirrors applyPatch()/apply_patch() in the TS/Python SDKs.
 */
public final class StatePatch {
    private StatePatch() {}

    public static void apply(ObjectNode state, JsonNode ops) {
        if (ops == null || !ops.isArray()) return;
        for (JsonNode op : ops) {
            String type = op.path("op").asText("");
            String path = op.path("path").asText("");
            if (!path.startsWith("/")) continue;
            if ("replace".equals(type) || "add".equals(type)) {
                setPath(state, path, op.has("value") ? op.get("value") : NullNode.getInstance());
            } else if ("remove".equals(type)) {
                removePath(state, path);
            }
        }
    }

    private static void setPath(ObjectNode root, String path, JsonNode value) {
        String[] keys = path.substring(1).split("/");
        ObjectNode current = root;
        for (int i = 0; i < keys.length - 1; i++) {
            JsonNode child = current.get(keys[i]);
            if (child == null || !child.isObject()) {
                ObjectNode next = current.objectNode();
                current.set(keys[i], next);
                current = next;
            } else {
                current = (ObjectNode) child;
            }
        }
        current.set(keys[keys.length - 1], value);
    }

    private static void removePath(ObjectNode root, String path) {
        String[] keys = path.substring(1).split("/");
        ObjectNode current = root;
        for (int i = 0; i < keys.length - 1; i++) {
            JsonNode child = current.get(keys[i]);
            if (child == null || !child.isObject()) return;
            current = (ObjectNode) child;
        }
        current.remove(keys[keys.length - 1]);
    }
}
