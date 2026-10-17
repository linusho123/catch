import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { decodeFrame, type FrameAck } from '../../shared/wire.ts'
import { openStore, type Store } from './store.ts'

// The server skeleton: GET /health, the SQLite store opened, and a WebSocket at
// /audio that accepts lens frames (shared/wire.ts) and acknowledges each with
// the byte count of its PCM. Speech-to-text, the split and the detectors hang
// off the /audio socket in later phases.

export interface ServerOptions {
  port: number
  host?: string
  dbPath: string
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

  const wss = new WebSocketServer({ server: http, path: '/audio' })
  wss.on('connection', (socket) => {
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
