import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { decodeFrame, type FrameAck } from '../../shared/wire.ts'
import { openStore, type Store } from './store.ts'

// The server skeleton: GET /health, the SQLite store opened, and a WebSocket at
// /audio that accepts lens frames (shared/wire.ts) and acknowledges each with
// the byte count of its PCM. Speech-to-text, the split and the detectors hang
// off the /audio socket in later phases.
//
// /audio is public on Fly, so it takes only clients that carry the shared token
// (operator ruling 2026-10-17): the lens sends it as `?token=` (a browser
// WebSocket cannot set headers), built in from VITE_CATCH_TOKEN; the server's
// copy is the Fly secret CATCH_AUDIO_TOKEN. Neither is ever committed.

export interface ServerOptions {
  port: number
  host?: string
  dbPath: string
  /** The shared token /audio requires (CATCH_AUDIO_TOKEN). Required: the socket never runs open. */
  audioToken: string
}

/**
 * The largest /audio message accepted (M6). A lens frame is 16 + 3200 bytes;
 * anything far past that is refused (close 1009) before ws buffers it.
 */
export const MAX_AUDIO_MESSAGE_BYTES = 64 * 1024

const digest = (s: string) => createHash('sha256').update(s).digest()

function carriesToken(req: IncomingMessage, expected: Buffer): boolean {
  const given = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token')
  return given !== null && timingSafeEqual(digest(given), expected)
}

export interface RunningServer {
  url: string
  store: Store
  close(): Promise<void>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  if (!opts.audioToken) throw new Error('CATCH_AUDIO_TOKEN is not set; /audio never runs without its shared token')
  const expectedToken = digest(opts.audioToken)
  const store = openStore(opts.dbPath)

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end()
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, store: 'sqlite', schema: store.schemaVersion() }))
      return
    }
    res.writeHead(404, CORS).end()
  })

  const wss = new WebSocketServer({
    server: http,
    path: '/audio',
    maxPayload: MAX_AUDIO_MESSAGE_BYTES,
    verifyClient: (info, done) => (carriesToken(info.req, expectedToken) ? done(true) : done(false, 401, 'Unauthorized')),
  })
  wss.on('connection', (socket) => {
    // An oversized message makes ws emit 'error' and close the socket with 1009;
    // unheard, that error would take the whole process down.
    socket.on('error', () => socket.terminate())
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return
      const bytes = data instanceof Buffer ? data : Buffer.concat(data as Buffer[])
      try {
        const frame = decodeFrame(bytes)
        const ack: FrameAck = { type: 'ack', seq: frame.seq, bytes: frame.pcm.byteLength }
        socket.send(JSON.stringify(ack))
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: (err as Error).message }))
      }
    })
  })

  await new Promise<void>((resolve) => http.listen(opts.port, opts.host ?? '0.0.0.0', resolve))
  const { port } = http.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    store,
    async close() {
      for (const client of wss.clients) client.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => http.close((err) => (err ? reject(err) : resolve())))
      store.close()
    },
  }
}
