export declare class CausetError extends Error {
    constructor(message: string);
}
export declare class CausetAuthError extends CausetError {
    constructor(message: string);
}
export declare class CausetApiError extends CausetError {
    statusCode: number;
    body: unknown;
    constructor(statusCode: number, message: string, body?: unknown);
}
//# sourceMappingURL=errors.d.ts.map