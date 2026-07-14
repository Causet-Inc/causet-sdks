import { describe, expect, it } from 'vitest';
import { generateIntentId } from '../intent-id.js';

describe('generateIntentId', () => {
  it('returns a non-empty string', () => {
    const id = generateIntentId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values', () => {
    expect(generateIntentId()).not.toBe(generateIntentId());
  });

  it('falls back when crypto.randomUUID is unavailable', () => {
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
      const id = generateIntentId();
      expect(id.startsWith('intent-')).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
    }
  });
});
