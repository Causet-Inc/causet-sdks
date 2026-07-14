export class CausetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CausetError';
  }
}

export class CausetAuthError extends CausetError {
  constructor(message: string) {
    super(message);
    this.name = 'CausetAuthError';
  }
}

export class CausetApiError extends CausetError {
  statusCode: number;
  body: unknown;

  constructor(statusCode: number, message: string, body: unknown = null) {
    super(`[${statusCode}] ${message}`);
    this.name = 'CausetApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}
