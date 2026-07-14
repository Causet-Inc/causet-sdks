export declare function getPath(obj: unknown, path: string): unknown;
export declare function setPath(obj: Record<string, unknown>, path: string, value: unknown): void;
export declare function applyPatch(state: Record<string, unknown>, ops: Array<{
    op?: string;
    path?: string;
    value?: unknown;
}> | null | undefined): void;
//# sourceMappingURL=patch.d.ts.map