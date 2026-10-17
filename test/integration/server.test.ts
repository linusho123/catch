import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { encodeFrame } from '../../shared/wire.ts'

// The server skeleton, started once for this file: the health endpoint, the
// store on disk (read directly, not through the server) and the audio socket.

let server: RunningServer
let dbPath: string

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'catch-server-')), 'catch.db')
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath })
})
afterAll(() => server.close())

function exchange(messages: Uint8Array[]): Promise<unknown[]> {
  const socket = new WebSocket(`${server.url.replace('http', 'ws')}/audio`)
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
})
