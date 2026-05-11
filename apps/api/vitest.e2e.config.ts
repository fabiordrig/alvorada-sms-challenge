import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['src/test/e2e/**/*.e2e.test.ts'],
  },
});
