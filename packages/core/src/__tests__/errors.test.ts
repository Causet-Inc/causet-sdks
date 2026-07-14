import { describe, expect, it } from 'vitest';
import { CausetApiError, CausetAuthError, CausetError } from '../errors.js';

describe('errors', () => {
  it('CausetError is an Error with message', () => {
    const err = new CausetError('something broke');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CausetError');
    expect(err.message).toBe('something broke');
  });

  it('CausetAuthError extends CausetError', () => {
    const err = new CausetAuthError('bad token');
    expect(err).toBeInstanceOf(CausetError);
    expect(err.name).toBe('CausetAuthError');
    expect(err.message).toBe('bad token');
  });

  it('CausetApiError has statusCode, body, and formatted message', () => {
    const err = new CausetApiError(422, 'Validation failed', { detail: 'missing field' });
    expect(err).toBeInstanceOf(CausetError);
    expect(err.name).toBe('CausetApiError');
    expect(err.statusCode).toBe(422);
    expect(err.body).toEqual({ detail: 'missing field' });
    expect(String(err)).toContain('422');
    expect(String(err)).toContain('Validation failed');
  });

  it('CausetApiError defaults body to null', () => {
    const err = new CausetApiError(500, 'Server error');
    expect(err.body).toBeNull();
  });
});
