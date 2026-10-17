import type { Clock, TimerHandle } from '../../shared/clock.ts'

// The fixture clock. Virtual time runs at `speed` times wall time (twenty by
// default; one under `--realtime` or CATCH_REAL_STT=1), so the real work the
// server and the lens do between a word and a payload still costs fixture
// time, and a two-second bound later means two fixture seconds. `advance`
// jumps across silence, firing every timer in the gap in order with the
// clock reading that timer's own time. Timers keep fixture order: two due at
// once fire in the order they were set.

interface Timer {
  at: number
  seq: number
  fn: () => void
}

export const DEFAULT_SPEED = 20

export function speedFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return env.CATCH_REALTIME === '1' || env.CATCH_REAL_STT === '1' ? 1 : DEFAULT_SPEED
}

export class VirtualClock implements Clock {
  private wallStart = performance.now()
  private base = 0
  private timers: Timer[] = []
  private seq = 0
  private real: ReturnType<typeof setTimeout> | undefined

  readonly speed: number

  constructor(speed: number = DEFAULT_SPEED) {
    if (!(speed > 0)) throw new Error(`clock speed must be positive, got ${speed}`)
    this.speed = speed
  }

  now(): number {
    return this.base + (performance.now() - this.wallStart) * this.speed
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer: Timer = { at: this.now() + Math.max(0, ms), seq: this.seq++, fn }
    const i = this.timers.findIndex((t) => t.at > timer.at)
    this.timers.splice(i === -1 ? this.timers.length : i, 0, timer)
    this.arm()
    return timer as unknown as TimerHandle
  }

  clearTimeout(handle: TimerHandle): void {
    const i = this.timers.indexOf(handle as unknown as Timer)
    if (i !== -1) this.timers.splice(i, 1)
    this.arm()
  }

  /** Resolves when the clock reads `at` (virtual ms). */
  sleepUntil(at: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, at - this.now()))
  }

  /** Jumps virtual time forward by `ms`, firing every timer due on the way, each at its own time. */
  advance(ms: number): void {
    if (ms < 0) throw new Error(`the clock only runs forward (advance ${ms})`)
    const target = this.now() + ms
    for (let next = this.timers[0]; next && next.at <= target; next = this.timers[0]) {
      this.timers.shift()
      this.rebase(Math.max(this.now(), next.at))
      next.fn()
    }
    this.rebase(Math.max(this.now(), target))
    this.arm()
  }

  /** Cancels every timer and sets the clock back to zero, for the next scenario. */
  reset(): void {
    this.timers = []
    this.rebase(0)
    this.arm()
  }

  private rebase(at: number): void {
    this.wallStart = performance.now()
    this.base = at
  }

  private arm(): void {
    if (this.real) clearTimeout(this.real)
    this.real = undefined
    const next = this.timers[0]
    if (!next) return
    this.real = setTimeout(() => this.fire(), Math.max(0, (next.at - this.now()) / this.speed))
  }

  private fire(): void {
    const now = this.now()
    for (let next = this.timers[0]; next && next.at <= now; next = this.timers[0]) {
      this.timers.shift()
      next.fn()
    }
    this.arm()
  }
}
