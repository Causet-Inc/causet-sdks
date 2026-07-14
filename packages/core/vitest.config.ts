import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/**/*.test.ts', 'src/types.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 97,
        statements: 100,
      },
    },
  },
});
