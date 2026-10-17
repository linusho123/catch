// The one clock the server and the lens read time from. In production it is
// the system clock; under test it is the harness's virtual clock
// (test/harness/clock.ts), so the fixture's timings and every later bound
// (two seconds for a name line, three for a promise) are measured on fixture
// time, not wall time. Milliseconds, like Date.now().

export type TimerHandle = { readonly __timer: unique symbol }

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
}
