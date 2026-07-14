import { describe, expect, it, vi } from 'vitest';
import { flattenProjectionItems, flattenProjectionRow, stringifyQueryInput, } from '../query-projection.js';
describe('flattenProjectionRow', () => {
    it('strips table prefix from dotted keys', () => {
        const row = {
            'artist_directory.artist_id': 'bruno-mars',
            'artist_directory.name': 'Bruno Mars',
            'show_directory.show_id': 'z7',
            'show_directory.venue_city': 'New York',
        };
        expect(flattenProjectionRow(row)).toEqual({
            artist_id: 'bruno-mars',
            name: 'Bruno Mars',
            show_id: 'z7',
            venue_city: 'New York',
        });
    });
    it('collision last-wins for same short key', () => {
        expect(flattenProjectionRow({ 'a.x': 1, 'b.x': 2 })).toEqual({ x: 2 });
    });
    it('keeps undotted keys as-is', () => {
        expect(flattenProjectionRow({ b: 2, id: 5 })).toEqual({ b: 2, id: 5 });
    });
    it('preserves non-string keys from entries', () => {
        vi.spyOn(Object, 'entries').mockReturnValueOnce([
            ['a.b', 1],
            [1, 'val'],
        ]);
        const flat = flattenProjectionRow({ 'a.b': 1 });
        expect(flat[1]).toBe('val');
        expect(flat.b).toBe(1);
        vi.restoreAllMocks();
    });
});
describe('flattenProjectionItems', () => {
    it('flattens object rows and passes through others', () => {
        expect(flattenProjectionItems([{ 't.a': 1 }, 'skip', { b: 2 }])).toEqual([
            { a: 1 },
            'skip',
            { b: 2 },
        ]);
    });
    it('passes through null and arrays', () => {
        expect(flattenProjectionItems([null, [1, 2]])).toEqual([null, [1, 2]]);
    });
});
describe('stringifyQueryInput', () => {
    it('returns empty object for null/undefined', () => {
        expect(stringifyQueryInput(null)).toEqual({});
        expect(stringifyQueryInput(undefined)).toEqual({});
    });
    it('stringifies primitives and collections', () => {
        expect(stringifyQueryInput({
            s: 'x',
            n: 50,
            f: 1.5,
            b: true,
            g: ['Pop', 'Rock'],
        })).toEqual({
            s: 'x',
            n: '50',
            f: '1.5',
            b: 'true',
            g: '["Pop","Rock"]',
        });
    });
    it('skips null and undefined values', () => {
        expect(stringifyQueryInput({ a: null, b: undefined, c: 'ok' })).toEqual({ c: 'ok' });
    });
    it('stringifies false boolean', () => {
        expect(stringifyQueryInput({ b: false })).toEqual({ b: 'false' });
    });
});
