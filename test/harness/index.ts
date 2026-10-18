import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { host } from './even-host.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { deepgram } from '../../server/src/stt/deepgram.ts'
import type { Lens } from '../../apps/lens/src/lens.ts'
import { speedFromEnv, VirtualClock } from './clock.ts'
import { modelForTests } from './model.ts'
import { NotificationCapture } from './notifications.ts'
import { FixtureRun, FixtureStt } from './player.ts'

// The test harness, one per test worker: the server started once on a
// throwaway store, the fixture clock it and the lens both read, the Even host
// the lens draws through, the fixture player, the notification capture and the
// model client on cassettes. `even-host.ts` is imported first, on purpose: the
// SDK must find the stand-in Even app when it loads.
//
// A scenario calls `reset()` first, then `startLens()`, then plays fixtures.
// The flags: CATCH_REAL_STT=1 gives the server the real provider (Deepgram)
// and runs the clock in real time; CATCH_REAL_LLM=1 records cassettes from the
// real model; `npm run test:fast -- --realtime` (CATCH_REALTIME=1) runs the
// clock in real time for timing probes. With all unset nothing leaves the
// machine (test/setup/no-network.ts).

/** A throwaway token for the harness only; the real one is the Fly secret CATCH_AUDIO_TOKEN. */
export const HARNESS_TOKEN = 'harness-token-not-a-secret'

export interface Harness {
  clock: VirtualClock
  server: RunningServer
  dbPath: string
  host: typeof host
  stt: FixtureStt
  notifications: NotificationCapture
  model: ModelClient
  /** Stops the last scenario's lenses (their sockets closed, so nothing of theirs is still in flight), forgets the wearer's session, switches thread detection back on, clears the record and sets the clock to zero. */
  reset(): Promise<void>
  /** Starts the lens against the server; rejects, loudly, if it cannot open /audio. */
  startLens(): Promise<Lens>
  /** Starts playing a fixture by name (test/fixtures/<name>.json); fixture second 0 is now. */
  play(name: string): FixtureRun
  close(): Promise<void>
}

let running: Promise<Harness> | undefined

/** The worker's harness, started on first use. The caller closes it in its afterAll. */
export function harness(): Promise<Harness> {
  running ??= start()
  return running
}

async function start(): Promise<Harness> {
  const clock = new VirtualClock(speedFromEnv())
  const stt = new FixtureStt(clock)
  const notifications = new NotificationCapture(clock)
  const model = modelForTests()
  const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-harness-')), 'catch.db')
  const realStt = process.env.CATCH_REAL_STT === '1'
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    dbPath,
    audioToken: HARNESS_TOKEN,
    clock,
    stt: realStt ? deepgram(process.env.DEEPGRAM_API_KEY ?? '') : stt,
    model,
    notifier: notifications,
  })
  stt.attach(server.events)
  const lenses: Lens[] = []
  host.reset(clock)
  const h: Harness = {
    clock,
    server,
    dbPath,
    host,
    stt,
    notifications,
    model,
    async reset() {
      await Promise.all(lenses.splice(0).map((lens) => lens.stop()))
      // The wearer's session outlives a socket (D79); a scenario starts with none.
      server.forgetWearers()
      // D120's switch back to its default: detection on.
      server.setThreadDetection(true)
      stt.reset()
      clock.reset()
      host.reset(clock)
      notifications.reset(clock)
    },
    async startLens() {
      const { evenBridge } = await import('./even-host.ts')
      const { startLens } = await import('../../apps/lens/src/lens.ts')
      const lens = await startLens({ bridge: await evenBridge(), server: server.url.replace(/^http/, 'ws'), token: HARNESS_TOKEN, now: () => clock.now() })
      lenses.push(lens)
      await lens.connected
      return lens
    },
    play: (name) => new FixtureRun(name, { clock, host, stt, realStt }),
    async close() {
      await h.reset()
      running = undefined
      await server.close()
    },
  }
  return h
}
