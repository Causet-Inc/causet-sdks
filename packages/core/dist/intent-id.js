/** Generate a unique intent id when the caller does not supply one (required by runtime submit). */
export function generateIntentId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
