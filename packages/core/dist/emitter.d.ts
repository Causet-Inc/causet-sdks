type Handler = (data: unknown) => void;
export declare class Emitter {
    private handlers;
    private wildcard;
    on(eventType: string, handler: Handler): () => void;
    emit(eventType: string, data?: unknown): void;
}
export {};
//# sourceMappingURL=emitter.d.ts.map