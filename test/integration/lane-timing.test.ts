import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The fast lane's cost: the whole of `npm run test:fast` (oxlint, the
// typecheck, unit, every feature file). BUILD-PLAN.md, P0a: "under one minute
// on a laptop at P1, under two at P10". Proved under one minute on the P0
// tree; raised to two minutes at the P4 fix round (operator answer 2), when
// the lane reached about 56 s against the old bound. Full lane only: the fast
// lane cannot time itself.

const ROOT = resolve(import.meta.dirname, '../..')
const ONE_MINUTE_MS = 60_000
/** The plan's bound at P10: under two minutes. */
const BOUND_MS = 2 * ONE_MINUTE_MS

describe('the fast lane', () => {
  it('passes in under two minutes', { timeout: 3 * ONE_MINUTE_MS }, () => {
    const env = { ...process.env }
    delete env.FEATURES
    delete env.CATCH_MANIFEST
    const start = performance.now()
    const run = spawnSync('node', ['scripts/lane.mjs', 'fast'], { cwd: ROOT, env, encoding: 'utf8' })
    const elapsed = performance.now() - start
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toMatch(/\[fast\] passed in/)
    expect(elapsed).toBeLessThan(BOUND_MS)
  })
})
