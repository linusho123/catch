import { describe, expect, it } from 'vitest'
import { DEFAULT_SPEED, speedFromEnv, VirtualClock } from '../harness/clock.ts'

// The fixture clock: fixture time runs at a known multiple of wall time, and a
// jump across silence fires every timer in the gap, in order, at its own time.

describe('the fixture clock', () => {
  it('runs at twenty times wall time by default, and at real time under --realtime or real speech-to-text', () => {
    expect(DEFAULT_SPEED).toBe(20)
    expect(speedFromEnv({})).toBe(20)
    expect(speedFromEnv({ CATCH_REALTIME: '1' })).toBe(1)
    expect(speedFromEnv({ CATCH_REAL_STT: '1' })).toBe(1)
  })

  it('measures fixture time at its speed', async () => {
    const clock = new VirtualClock(20)
    const wall = performance.now()
    await clock.sleepUntil(1000)
    const elapsedWall = performance.now() - wall
    expect(clock.now()).toBeGreaterThanOrEqual(1000)
    // One fixture second is 50 ms of wall time at twenty times.
    expect(elapsedWall).toBeGreaterThanOrEqual(45)
    expect(elapsedWall).toBeLessThan(500)
  })

  it('fires the timers inside a jump in fixture order, each reading its own time', () => {
    // Near-frozen, so only advance() moves it: at speed 1 a loaded machine's
    // milliseconds between setting the timers put one at 1501 (a flake).
    const clock = new VirtualClock(1e-9)
    const seen: [string, number][] = []
    const note = (name: string) => () => seen.push([name, Math.round(clock.now())])
    clock.setTimeout(note('ten minutes'), 600_000)
    clock.setTimeout(note('fade'), 1500)
    clock.setTimeout(note('fade, second'), 1500)
    const dropped = clock.setTimeout(note('cancelled'), 2000)
    clock.clearTimeout(dropped)
    clock.advance(600_000)
    expect(seen).toEqual([
      ['fade', 1500],
      ['fade, second', 1500],
      ['ten minutes', 600_000],
    ])
    expect(clock.now()).toBeGreaterThanOrEqual(600_000)
  })

  it('refuses to run backwards, and resets to zero with no timers left', () => {
    const clock = new VirtualClock(1)
    expect(() => clock.advance(-1)).toThrow(/forward/)
    let fired = false
    clock.setTimeout(() => (fired = true), 10)
    clock.advance(5000)
    clock.reset()
    expect(clock.now()).toBeLessThan(50)
    clock.setTimeout(() => (fired = false), 100_000)
    clock.reset()
    clock.advance(200_000)
    expect(fired).toBe(true)
  })
})
