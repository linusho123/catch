import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { host } from './even-host.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { deepgram } from '../../server/src/stt/deepgram.ts'
import type { Lens } from '../../apps/lens/src/lens.ts'
import { speedFromEnv, VirtualClock } from './clock.ts'
import { modelForTests } from './model.ts'
import { NotificationCapture } from './notifications.ts'
import { FixtureRun, FixtureStt } from './player.ts'
import { audioProtocols } from '../../shared/audio-token.ts'

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

/** A second account's throwaway token (D79): another pair of glasses, another phone (fix round, test-2). */
export const OTHER_HARNESS_TOKEN = 'harness-other-account-not-a-secret'

export interface Harness {
  clock: VirtualClock
  server: RunningServer
  dbPath: string
  host: typeof host
  stt: FixtureStt
  notifications: NotificationCapture
  model: ModelClient
  /** Every model pass the server reports failed since the last reset (a missing cassette among them): a scenario fails on any (lens-world.ts). */
  modelErrors: unknown[]
  /** Stops the last scenario's lenses (their sockets closed, so nothing of theirs is still in flight), forgets the wearer's session, switches thread detection back on, clears the record and the store, and sets the clock to zero. */
  reset(): Promise<void>
  /** Starts the lens against the server; rejects, loudly, if it cannot open /audio. */
  startLens(): Promise<Lens>
  /**
   * The Even app is killed (P9): every running lens stops, its socket closed,
   * and the speech-to-text provider hears nothing said until a lens is back
   * (FixtureStt.appGone).
   */
  killApp(): Promise<void>
  /**
   * The server process restarts on the same store (P9): closed, with nothing
   * of its memory kept, and started again with the same clock, provider,
   * model and phone. `server` is the new one afterwards.
   */
  restartServer(): Promise<void>
  /**
   * Signs another pair of glasses in to the second account
   * (OTHER_HARNESS_TOKEN), as a bare /audio socket, and resolves once the
   * server holds that account's session and shows it the dot. Call it before
   * startLens: the fixture provider has one stream, and the scenario's lens
   * must hold it. Closed by the next reset.
   */
  signInOtherAccount(): Promise<WebSocket>
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
  const modelErrors: unknown[] = []
  const serve = async () => {
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      dbPath,
      audioToken: HARNESS_TOKEN,
      clock,
      stt: realStt ? deepgram(process.env.DEEPGRAM_API_KEY ?? '') : stt,
      model,
      notifier: notifications,
      otherAudioTokens: [OTHER_HARNESS_TOKEN],
    })
    stt.attach(started.events)
    started.events.on('modelError', ({ error }) => modelErrors.push(error))
    return started
  }
  let server = await serve()
  const lenses: Lens[] = []
  const others: WebSocket[] = []
  host.reset(clock)
  const h: Harness = {
    clock,
    get server() {
      return server
    },
    dbPath,
    host,
    stt,
    notifications,
    model,
    modelErrors,
    async reset() {
      await Promise.all(lenses.splice(0).map((lens) => lens.stop()))
      for (const socket of others.splice(0)) socket.terminate()
      // The wearer's session outlives a socket (D79); a scenario starts with none.
      server.forgetWearers()
      // D120's switch back to its default: detection on.
      server.setThreadDetection(true)
      stt.reset()
      clock.reset()
      host.reset(clock)
      notifications.reset(clock)
      modelErrors.length = 0
      // A scenario starts with an empty store: no history, no transcript left by the last one (the clock starts again at zero).
      const db = server.store.db
      const names = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'meta'").all() as { name: string }[]
      db.exec('PRAGMA foreign_keys = OFF')
      for (const { name } of names) db.exec(`DELETE FROM "${name}"`)
      db.exec('PRAGMA foreign_keys = ON')
    },
    async startLens() {
      const { evenBridge } = await import('./even-host.ts')
      const { startLens } = await import('../../apps/lens/src/lens.ts')
      const lens = await startLens({ bridge: await evenBridge(), server: server.url.replace(/^http/, 'ws'), token: HARNESS_TOKEN, now: host.captureClock(clock) })
      lenses.push(lens)
      await lens.connected
      return lens
    },
    async killApp() {
      await Promise.all(lenses.splice(0).map((lens) => lens.stop()))
      stt.appGone()
    },
    async restartServer() {
      await server.close()
      server = await serve()
    },
    async signInOtherAccount() {
      const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?lens=other-account`, audioProtocols(OTHER_HARNESS_TOKEN))
      others.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.on('message', (data) => {
          const msg = JSON.parse(String(data)) as { type: string; view?: { kind: string } }
          if (msg.type === 'show' && msg.view?.kind === 'dot') resolve()
        })
        socket.once('error', reject)
        socket.once('unexpected-response', (_req, res) => reject(new Error(`the second account could not open /audio: ${res.statusCode}`)))
      })
      return socket
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
