import { describe, expect, it } from 'vitest';
import { applyPatch, getPath, setPath } from '../patch.js';

describe('getPath', () => {
  it('reads simple key', () => {
    expect(getPath({ a: 1 }, '/a')).toBe(1);
  });

  it('reads nested key', () => {
    expect(getPath({ a: { b: { c: 42 } } }, '/a/b/c')).toBe(42);
  });

  it('returns undefined for missing key', () => {
    expect(getPath({ a: 1 }, '/b')).toBeUndefined();
  });

  it('returns null for path without leading slash', () => {
    expect(getPath({ a: 1 }, 'a')).toBeNull();
  });

  it('returns null for empty path', () => {
    expect(getPath({ a: 1 }, '')).toBeNull();
  });

  it('returns null when object is null', () => {
    expect(getPath(null, '/a')).toBeNull();
  });

  it('reads array index', () => {
    expect(getPath({ items: [10, 20, 30] }, '/items/1')).toBe(20);
  });

  it('returns null for non-numeric array index', () => {
    expect(getPath({ items: [10] }, '/items/foo')).toBeNull();
  });

  it('returns null when traversing through non-object', () => {
    expect(getPath({ a: 'string' }, '/a/b')).toBeNull();
  });
});

describe('setPath', () => {
  it('sets simple key', () => {
    const obj = { a: 1 };
    setPath(obj, '/a', 2);
    expect(obj.a).toBe(2);
  });

  it('creates nested intermediates', () => {
    const obj: Record<string, unknown> = {};
    setPath(obj, '/a/b/c', 42);
    expect(obj).toEqual({ a: { b: { c: 42 } } });
  });

  it('replaces null child with object', () => {
    const obj: Record<string, unknown> = { a: null };
    setPath(obj, '/a/b', 1);
    expect(obj).toEqual({ a: { b: 1 } });
  });

  it('replaces array child with object', () => {
    const obj: Record<string, unknown> = { a: [1, 2] };
    setPath(obj, '/a/b', 1);
    expect(obj).toEqual({ a: { b: 1 } });
  });

  it('ignores path without leading slash', () => {
    const obj = { a: 1 };
    setPath(obj, 'a', 2);
    expect(obj.a).toBe(1);
  });

  it('ignores empty path', () => {
    const obj = { a: 1 };
    setPath(obj, '', 2);
    expect(obj).toEqual({ a: 1 });
  });
});

describe('applyPatch', () => {
  it('replace op', () => {
    const state = { name: 'Alice' };
    applyPatch(state, [{ op: 'replace', path: '/name', value: 'Bob' }]);
    expect(state.name).toBe('Bob');
  });

  it('add op', () => {
    const state: Record<string, unknown> = {};
    applyPatch(state, [{ op: 'add', path: '/score', value: 100 }]);
    expect(state.score).toBe(100);
  });

  it('remove op at root', () => {
    const state = { a: 1, b: 2 };
    applyPatch(state, [{ op: 'remove', path: '/b' }]);
    expect(state).toEqual({ a: 1 });
  });

  it('remove nested op', () => {
    const state = { user: { name: 'Alice', age: 30 } };
    applyPatch(state, [{ op: 'remove', path: '/user/age' }]);
    expect(state).toEqual({ user: { name: 'Alice' } });
  });

  it('multiple ops', () => {
    const state = { x: 1 };
    applyPatch(state, [
      { op: 'replace', path: '/x', value: 2 },
      { op: 'add', path: '/y', value: 3 },
    ]);
    expect(state).toEqual({ x: 2, y: 3 });
  });

  it('ignores null ops', () => {
    const state = { a: 1 };
    applyPatch(state, null);
    expect(state).toEqual({ a: 1 });
  });

  it('ignores undefined ops', () => {
    const state = { a: 1 };
    applyPatch(state, undefined);
    expect(state).toEqual({ a: 1 });
  });

  it('skips invalid path', () => {
    const state = { a: 1 };
    applyPatch(state, [{ op: 'replace', path: 'no-slash', value: 2 }]);
    expect(state).toEqual({ a: 1 });
  });

  it('skips remove when parent is missing', () => {
    const state = { a: 1 };
    applyPatch(state, [{ op: 'remove', path: '/missing/key' }]);
    expect(state).toEqual({ a: 1 });
  });

  it('skips remove when parent is array', () => {
    const state = { items: [1, 2] };
    applyPatch(state, [{ op: 'remove', path: '/items/0' }]);
    expect(state).toEqual({ items: [1, 2] });
  });

  it('uses empty path default for missing path field', () => {
    const state = { a: 1 };
    applyPatch(state, [{ op: 'replace', value: 2 }]);
    expect(state).toEqual({ a: 1 });
  });
});
