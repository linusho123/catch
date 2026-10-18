import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { lensStyleFromEnv, startServer, type RunningServer } from '../../server/src/app.ts'
import { audioProtocols } from '../../shared/audio-token.ts'

// Readability pass (operator, on the real G2): the server tells each lens how
// to draw, so the brightness and the dot can be tuned on the glasses from a
// Fly secret, without a new package (DESIGN.md, chosen).
const TOKEN = 'style-test-token-not-a-secret'
let running: RunningServer | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
})

/** The first messages a new lens is sent, gathered for a moment after it connects. */
async function greeting(server: RunningServer): Promise<unknown[]> {
  const socket = new WebSocket(`${server.url.replace('http', 'ws')}/audio`, audioProtocols(TOKEN))
  const got: unknown[] = []
  socket.on('message', (data) => got.push(JSON.parse(String(data))))
  await new Promise((resolve, reject) => {
    socket.on('open', resolve)
    socket.on('error', reject)
  })
  await new Promise((resolve) => setTimeout(resolve, 150))
  socket.close()
  return got
}

describe('the lens style', () => {
  it('is sent to each lens as its socket is taken, when the server has one', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-style-')), 'catch.db')
    running = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, lensStyle: { brightness: 3, dot: { x: 548, y: 2 } } })
    expect(await greeting(running)).toContainEqual({ type: 'style', style: { brightness: 3, dot: { x: 548, y: 2 } } })
  })

  it('is not sent at all when the server has none, so the lens keeps its defaults', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-style-')), 'catch.db')
    running = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN })
    expect((await greeting(running)).filter((m) => (m as { type: string }).type === 'style')).toEqual([])
  })

  it('comes from CATCH_LENS_BRIGHTNESS, CATCH_DOT_X and CATCH_DOT_Y, defaults filling what is unset', () => {
    expect(lensStyleFromEnv({})).toBeUndefined()
    expect(lensStyleFromEnv({ CATCH_LENS_BRIGHTNESS: '3' })).toEqual({ brightness: 3, dot: { x: 552, y: 0 } })
    expect(lensStyleFromEnv({ CATCH_DOT_X: '560', CATCH_DOT_Y: '4' })).toEqual({ brightness: 1, dot: { x: 560, y: 4 } })
    expect(() => lensStyleFromEnv({ CATCH_LENS_BRIGHTNESS: 'bright' })).toThrow(/CATCH_LENS_BRIGHTNESS/)
  })
})
