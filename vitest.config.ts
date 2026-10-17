import { defineConfig } from 'vitest/config'

// Three Vitest projects. The fast lane runs `unit` and `features` (filtered by
// FEATURES); the full lane runs all three. `integration` opens real sockets and
// files, so it stays out of the fast lane. Vitest never type-checks.
export default defineConfig({
  test: {
    slowTestThreshold: 300,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'apps/lens/src/**/*.test.ts', 'test/unit/**/*.test.ts'],
        },
      },
      { extends: true, test: { name: 'integration', include: ['test/integration/**/*.test.ts'] } },
      { extends: true, test: { name: 'features', include: ['test/features.test.ts'] } },
    ],
  },
})
