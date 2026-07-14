export class CausetError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CausetError';
    }
}
export class CausetAuthError extends CausetError {
    constructor(message) {
        super(message);
        this.name = 'CausetAuthError';
    }
}
export class CausetApiError extends CausetError {
    statusCode;
    body;
    constructor(statusCode, message, body = null) {
        super(`[${statusCode}] ${message}`);
        this.name = 'CausetApiError';
        this.statusCode = statusCode;
        this.body = body;
    }
}
