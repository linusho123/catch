import { defineConfig } from 'vitest/config'

// Three Vitest projects. The fast lane runs `unit` and `features` (filtered by
// FEATURES); the full lane runs all three. `integration` opens real sockets and
// files, so it stays out of the fast lane. Vitest never type-checks. Every
// project loads test/setup/no-network.ts: no test reaches past loopback.
export default defineConfig({
  test: {
    slowTestThreshold: 300,
    setupFiles: ['test/setup/no-network.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'apps/lens/src/**/*.test.ts', 'test/unit/**/*.test.ts'],
        },
      },
      // One file at a time: the lane-timing test spawns a whole fast lane, and the
      // harness smoke tests measure fixture time against wall time.
      { extends: true, test: { name: 'integration', include: ['test/integration/**/*.test.ts'], fileParallelism: false } },
      { extends: true, test: { name: 'features', include: ['test/features.test.ts'] } },
    ],
  },
})
