import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evenBridge, host } from '../harness/even-host.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { VirtualClock } from '../harness/clock.ts'
import { FixtureStt } from '../harness/player.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { RECONNECT_MS } from '../../apps/lens/src/lens.ts'
import { isDotOnly, screenAt, screens, visible } from '../steps/lens-world.ts'

// D37 when the server itself is gone, not only its speech-to-text: the lens
// alone knows it cannot hear, takes the dot away, and keeps trying; when the
// server answers again (and its provider takes the stream) the dot returns.
// Read from the bridge stub's record. The reconnect waits on wall time
// (RECONNECT_MS), so this lives in the integration project.

const clock = new VirtualClock(1)
const cleanups: (() => Promise<unknown> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

const dbPath = () => join(mkdtempSync(join(tmpdir(), 'catch-reconnect-')), 'catch.db')
const showing = () => screenAt({ host }, clock.now())

async function within(ms: number, test: () => boolean): Promise<boolean> {
  const until = performance.now() + ms
  while (performance.now() < until) {
    if (test()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return test()
}

async function serve(port = 0): Promise<RunningServer> {
  return startServer({ port, host: '127.0.0.1', dbPath: dbPath(), audioToken: HARNESS_TOKEN, clock, stt: new FixtureStt(clock) })
}

describe('the lens without its server (D37)', () => {
  it('takes the dot away while the server is unreachable, and draws it again when the server answers', async () => {
    host.reset(clock)
    let server = await serve()
    const port = Number(new URL(server.url).port)
    const { startLens } = await import('../../apps/lens/src/lens.ts')
    const lens = await startLens({ bridge: await evenBridge(), server: `ws://127.0.0.1:${port}`, token: HARNESS_TOKEN, now: () => clock.now() })
    cleanups.push(() => lens.stop())
    await lens.connected
    expect(await within(1000, () => isDotOnly(showing()!))).toBe(true)

    // The server goes away.
    const downAt = clock.now()
    await server.close()
    expect(await within(1000, () => visible(showing()!).length === 0)).toBe(true)
    const gone = screens({ host }).find((s) => s.at >= downAt && visible(s).length === 0)!
    expect(gone.at - downAt).toBeLessThan(500)

    // It stays dark across a failed attempt to reach the server ...
    await new Promise((r) => setTimeout(r, RECONNECT_MS + 200))
    expect(visible(showing()!)).toEqual([])

    // ... and the dot is back once the server answers on the same address.
    server = await serve(port)
    cleanups.push(() => server.close())
    expect(await within(RECONNECT_MS + 1000, () => isDotOnly(showing()!))).toBe(true)
  }, 15_000)

  it('starts with no dot: the lens cannot hear until the server says it can', async () => {
    host.reset(clock)
    const { startLens } = await import('../../apps/lens/src/lens.ts')
    const probe = await serve()
    const port = new URL(probe.url).port
    await probe.close()
    const lens = await startLens({ bridge: await evenBridge(), server: `ws://127.0.0.1:${port}`, token: HARNESS_TOKEN, now: () => clock.now() })
    cleanups.push(() => lens.stop())
    await expect(lens.connected).rejects.toThrow(/could not open/)
    expect(screens({ host }).every((s) => visible(s).length === 0)).toBe(true)
  })
})
