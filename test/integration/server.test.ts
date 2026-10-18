import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { MAX_AUDIO_MESSAGE_BYTES, startServer, type RunningServer } from '../../server/src/app.ts'
import { AUDIO_PROTOCOL, audioProtocols, tokenProtocol } from '../../shared/audio-token.ts'
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

const audioUrl = (at: RunningServer = server) => `${at.url.replace('http', 'ws')}/audio`

/**
 * Opens /audio as the lens does, the token as a subprotocol (PH), and reports
 * how the server answered: open, refused with an HTTP status, or an error.
 * `url` and `protocols` stand in for a client that does it some other way.
 */
function connect(
  token?: string,
  how: { url?: string; protocols?: string[]; at?: RunningServer } = {},
): Promise<{ opened: boolean; status?: number; body?: string; socket: WebSocket }> {
  const socket = new WebSocket(how.url ?? audioUrl(how.at), how.protocols ?? (token === undefined ? [] : audioProtocols(token)))
  return new Promise((resolve, reject) => {
    socket.on('open', () => resolve({ opened: true, socket }))
    socket.on('unexpected-response', (_req, res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk.toString()))
      res.on('end', () => {
        resolve({ opened: false, status: res.statusCode, body, socket })
        socket.terminate()
      })
    })
    socket.on('error', (err) => {
      if (socket.readyState !== WebSocket.CLOSED) reject(err)
    })
  })
}

/** A WebSocket upgrade by hand, with `protocol` as its Sec-WebSocket-Protocol header; resolves the HTTP status it was answered with. */
function rawUpgrade(protocol: string): Promise<number> {
  const { hostname, port } = new URL(server.url)
  return new Promise((resolve, reject) => {
    const req = request({
      hostname,
      port,
      path: '/audio',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        'sec-websocket-protocol': protocol,
      },
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('upgrade', (_res, socket) => {
      socket.destroy()
      resolve(101)
    })
    req.on('error', reject)
    req.end()
  })
}

function exchange(messages: Uint8Array[]): Promise<unknown[]> {
  const socket = new WebSocket(audioUrl(), audioProtocols(TOKEN))
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

  it('takes the token only as a subprotocol: the right token in ?token= alone is refused (PH)', async () => {
    const inUrl = await connect(undefined, { url: `${audioUrl()}?token=${encodeURIComponent(TOKEN)}` })
    expect(inUrl).toMatchObject({ opened: false, status: 401 })
    // The lens's way, with the query the old lens sent beside it, still opens: the query is never read.
    const both = await connect(TOKEN, { url: `${audioUrl()}?token=not-the-token&lens=x` })
    expect(both.opened).toBe(true)
    both.socket.close()
  })

  it('echoes the plain protocol, never the one carrying the token, so a browser accepts the handshake (PH)', async () => {
    const lens = await connect(TOKEN)
    expect(lens.socket.protocol).toBe(AUDIO_PROTOCOL)
    lens.socket.close()
    // Whatever the order offered, the answer is the plain protocol when there is one.
    const reversed = await connect(undefined, { protocols: [tokenProtocol(TOKEN), AUDIO_PROTOCOL] })
    expect(reversed.socket.protocol).toBe(AUDIO_PROTOCOL)
    reversed.socket.close()
    // A client that offers the token protocol alone gets that one back (a browser fails a handshake that echoes none).
    const alone = await connect(undefined, { protocols: [tokenProtocol(TOKEN)] })
    expect(alone.opened).toBe(true)
    expect(alone.socket.protocol).toBe(tokenProtocol(TOKEN))
    alone.socket.close()
    // The plain protocol alone carries no token.
    expect(await connect(undefined, { protocols: [AUDIO_PROTOCOL] })).toMatchObject({ opened: false, status: 401 })
  })

  it('takes a rotated base64 token with + / = on /audio and on the phone API (PH)', async () => {
    const rotated = `${randomBytes(32).toString('base64').slice(0, 40)}+/a=`
    expect(rotated).toMatch(/[+/=]/)
    const at = await startServer({ port: 0, host: '127.0.0.1', dbPath: join(mkdtempSync(join(tmpdir(), 'catch-rotated-')), 'catch.db'), audioToken: rotated })
    try {
      const lens = await connect(rotated, { at })
      expect(lens.opened).toBe(true)
      lens.socket.close()
      // One character off is another token.
      expect(await connect(rotated.replace('+/a=', '+/b='), { at })).toMatchObject({ opened: false, status: 401 })
      const phone = await fetch(`${at.url}/phone/history`, { headers: { authorization: `Bearer ${rotated}` } })
      expect(phone.status).toBe(200)
      expect((await fetch(`${at.url}/phone/history`)).status).toBe(401)
    } finally {
      await at.close()
    }
  })

  it('refuses a handshake it cannot read without falling over, and says nothing of the token offered (PH)', async () => {
    const said: string[] = []
    const spies = (['log', 'warn', 'error'] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(' '))))
    try {
      const wrong = 'wrong+token/value=='
      const refused = await connect(wrong)
      expect(refused).toMatchObject({ opened: false, status: 401 })
      expect(refused.body).not.toContain(wrong)
      expect(refused.body).not.toContain(tokenProtocol(wrong))
      // Raw upgrades a browser would never send: a header ws cannot parse, a token protocol that is not base64url, an empty one.
      for (const header of ['catch, catch', 'not a token', 'catch.!!!', 'catch.', `catch.${'A'.repeat(4000)}`]) {
        expect(await rawUpgrade(header), header.slice(0, 20)).toBeGreaterThanOrEqual(400)
      }
      expect((await fetch(`${server.url}/health`)).status).toBe(200)
      const right = await connect(TOKEN)
      expect(right.opened).toBe(true)
      right.socket.close()
      for (const line of said) {
        expect(line).not.toContain(wrong)
        expect(line).not.toContain(TOKEN)
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
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
