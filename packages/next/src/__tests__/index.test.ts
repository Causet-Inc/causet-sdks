import { describe, expect, it } from 'vitest';
import * as next from '../index.js';

describe('package exports', () => {
  it('re-exports hooks and core types', () => {
    expect(next.CausetProvider).toBeTypeOf('function');
    expect(next.useCausetClient).toBeTypeOf('function');
    expect(next.useCausetQuery).toBeTypeOf('function');
    expect(next.useCausetSubmitIntent).toBeTypeOf('function');
    expect(next.useCausetIntent).toBeTypeOf('function');
    expect(next.useCausetEntity).toBeTypeOf('function');
    expect(next.CausetClient).toBeTypeOf('function');
  });
});
