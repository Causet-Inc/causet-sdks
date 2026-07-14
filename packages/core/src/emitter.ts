type Handler = (data: unknown) => void;
type WildcardHandler = (eventType: string, data: unknown) => void;

export class Emitter {
  private handlers = new Map<string, Set<Handler>>();
  private wildcard = new Set<WildcardHandler>();

  on(eventType: string, handler: Handler): () => void {
    if (eventType === '*') {
      this.wildcard.add(handler as WildcardHandler);
      return () => this.wildcard.delete(handler as WildcardHandler);
    }
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  emit(eventType: string, data: unknown = null): void {
    for (const h of this.handlers.get(eventType) ?? []) {
      try {
        h(data);
      } catch {
        /* handler errors are ignored */
      }
    }
    for (const h of this.wildcard) {
      try {
        h(eventType, data);
      } catch {
        /* handler errors are ignored */
      }
    }
  }
}
