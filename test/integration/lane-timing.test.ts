import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The fast lane's cost, proved on the P0 tree: the whole of `npm run
// test:fast` (oxlint, the typecheck, unit, every feature file) under one
// minute. Full lane only: the fast lane cannot time itself.

const ROOT = resolve(import.meta.dirname, '../..')
const ONE_MINUTE_MS = 60_000

describe('the fast lane', () => {
  it('passes in under one minute', { timeout: 3 * ONE_MINUTE_MS }, () => {
    const env = { ...process.env }
    delete env.FEATURES
    delete env.CATCH_MANIFEST
    const start = performance.now()
    const run = spawnSync('node', ['scripts/lane.mjs', 'fast'], { cwd: ROOT, env, encoding: 'utf8' })
    const elapsed = performance.now() - start
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toMatch(/\[fast\] passed in/)
    expect(elapsed).toBeLessThan(ONE_MINUTE_MS)
  })
})
