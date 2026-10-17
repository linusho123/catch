import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { VirtualClock } from '../harness/clock.ts'
import { FixtureStt } from '../harness/player.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { LensView, ServerMessage } from '../../shared/lens-protocol.ts'

// D37 at the server's edge: when the speech-to-text stream drops, the server
// tells the lens there is no dot, keeps trying the provider, and sends the dot
// the moment a stream opens again, at whatever moment the provider returns
// (the staying-dark feature returns it after exactly one minute, which any
// retry cadence dividing sixty seconds would meet). Read from what the lens is
// sent over /audio.

const TOKEN = 'stt-reconnect-token'
/** "The moment it can": within a second of the provider answering again (the server's retry, STT_RETRY_MS). */
const MOMENT_MS = 1000
const clock = new VirtualClock()
const stt = new FixtureStt(clock)
let server: RunningServer

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: join(mkdtempSync(join(tmpdir(), 'catch-stt-')), 'catch.db'), audioToken: TOKEN, clock, stt })
})
afterAll(() => server.close())

describe('the server when speech-to-text drops (D37)', () => {
  for (const downFor of [7_300, 23_900, 1_100]) {
    it(`sends the dot back within a second of the provider returning, after ${downFor} ms down`, async () => {
      stt.reset()
      const views: { at: number; view: LensView }[] = []
      const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?token=${TOKEN}`)
      socket.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as ServerMessage
        if (msg.type === 'show') views.push({ at: clock.now(), view: msg.view })
      })
      await new Promise((resolve) => socket.on('open', resolve))
      const settle = async (ms: number) => clock.sleepUntil(clock.now() + ms)
      await settle(200)
      expect(views.at(-1)?.view).toEqual({ kind: 'dot' })

      stt.loseConnection()
      await settle(200)
      expect(views.at(-1)?.view).toEqual({ kind: 'deaf' })
      await settle(downFor)
      expect(views.at(-1)?.view, 'no dot while the provider is down').toEqual({ kind: 'deaf' })

      const restoredAt = clock.now()
      stt.restore()
      await settle(MOMENT_MS + 400)
      const back = views.find((v) => v.at >= restoredAt && v.view.kind === 'dot')
      expect(back, `the dot was not back within ${MOMENT_MS} ms of the provider returning`).toBeDefined()
      expect(back!.at - restoredAt).toBeLessThanOrEqual(MOMENT_MS + 300)
      socket.close()
      await new Promise((resolve) => socket.on('close', resolve))
    })
  }
})
