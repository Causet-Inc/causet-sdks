export class Emitter {
    handlers = new Map();
    wildcard = new Set();
    on(eventType, handler) {
        if (eventType === '*') {
            this.wildcard.add(handler);
            return () => this.wildcard.delete(handler);
        }
        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, new Set());
        }
        this.handlers.get(eventType).add(handler);
        return () => this.handlers.get(eventType)?.delete(handler);
    }
    emit(eventType, data = null) {
        for (const h of this.handlers.get(eventType) ?? []) {
            try {
                h(data);
            }
            catch {
                /* handler errors are ignored */
            }
        }
        for (const h of this.wildcard) {
            try {
                h(eventType, data);
            }
            catch {
                /* handler errors are ignored */
            }
        }
    }
}
