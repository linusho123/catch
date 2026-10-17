import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { MAX_AUDIO_MESSAGE_BYTES, startServer, type RunningServer } from '../../server/src/app.ts'
import { encodeFrame } from '../../shared/wire.ts'

// The server skeleton, started once for this file: the health endpoint, the
// store on disk (read directly, not through the server) and the audio socket.

let server: RunningServer
let dbPath: string
// A throwaway token for this file only; the real one is the Fly secret CATCH_AUDIO_TOKEN.
const TOKEN = 'test-token-not-a-secret'

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'catch-server-')), 'catch.db')
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN })
})
afterAll(() => server.close())

const audioUrl = (token?: string) =>
  `${server.url.replace('http', 'ws')}/audio${token === undefined ? '' : `?token=${encodeURIComponent(token)}`}`

/** Opens /audio and reports how the server answered: open, refused with an HTTP status, or an error. */
function connect(token?: string): Promise<{ opened: boolean; status?: number; socket: WebSocket }> {
  const socket = new WebSocket(audioUrl(token))
  return new Promise((resolve, reject) => {
    socket.on('open', () => resolve({ opened: true, socket }))
    socket.on('unexpected-response', (_req, res) => {
      resolve({ opened: false, status: res.statusCode, socket })
      socket.terminate()
    })
    socket.on('error', (err) => {
      if (socket.readyState !== WebSocket.CLOSED) reject(err)
    })
  })
}

function exchange(messages: Uint8Array[]): Promise<unknown[]> {
  const socket = new WebSocket(audioUrl(TOKEN))
  const replies: unknown[] = []
  return new Promise((resolve, reject) => {
    socket.on('open', () => messages.forEach((m) => socket.send(m)))
    socket.on('message', (data) => {
      replies.push(JSON.parse(data.toString()))
      if (replies.length === messages.length) {
        socket.close()
        resolve(replies)
      }
    })
    socket.on('error', reject)
  })
}

describe('the server skeleton', () => {
  it('answers the health endpoint with CORS', async () => {
    const res = await fetch(`${server.url}/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual({ ok: true, store: 'sqlite', schema: 1 })
  })

  it('opens the SQLite store on disk', () => {
    expect(existsSync(dbPath)).toBe(true)
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: '1' })
    } finally {
      db.close()
    }
  })

  it('acknowledges each 100 ms PCM frame with its byte count', async () => {
    const frame = (seq: number, bytes: number) =>
      encodeFrame({ seq, captureMs: seq * 100, speakerRole: 'unknown', direction: null, pcm: new Uint8Array(bytes) })
    expect(await exchange([frame(0, 3200), frame(1, 3200), frame(2, 640)])).toEqual([
      { type: 'ack', seq: 0, bytes: 3200 },
      { type: 'ack', seq: 1, bytes: 3200 },
      { type: 'ack', seq: 2, bytes: 640 },
    ])
  })

  it('answers a malformed frame with an error instead of dropping the socket', async () => {
    const [reply] = await exchange([new Uint8Array(5)])
    expect(reply).toMatchObject({ type: 'error', message: expect.stringMatching(/too short/) })
  })

  it('refuses /audio without the shared token, or with a wrong one (operator ruling 2026-10-17)', async () => {
    const without = await connect()
    expect(without).toMatchObject({ opened: false, status: 401 })
    const wrong = await connect('not-the-token')
    expect(wrong).toMatchObject({ opened: false, status: 401 })
    const right = await connect(TOKEN)
    expect(right.opened).toBe(true)
    right.socket.close()
  })

  it('refuses to start without an audio token', async () => {
    await expect(startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: '' })).rejects.toThrow(/CATCH_AUDIO_TOKEN/)
  })

  it('closes the socket on a message far larger than a lens frame (M6)', async () => {
    const { socket } = await connect(TOKEN)
    const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)))
    socket.on('error', () => {})
    socket.send(new Uint8Array(MAX_AUDIO_MESSAGE_BYTES + 1))
    expect(await closed).toBe(1009)
    // The server outlives the refusal.
    expect((await fetch(`${server.url}/health`)).status).toBe(200)
  })

  it('still accepts a message at the size limit (M6)', async () => {
    const big = encodeFrame({ seq: 9, captureMs: 0, speakerRole: 'unknown', direction: null, pcm: new Uint8Array(MAX_AUDIO_MESSAGE_BYTES - 16) })
    expect(await exchange([big])).toEqual([{ type: 'ack', seq: 9, bytes: MAX_AUDIO_MESSAGE_BYTES - 16 }])
    expect(MAX_AUDIO_MESSAGE_BYTES).toBeLessThanOrEqual(64 * 1024)
  })
})
