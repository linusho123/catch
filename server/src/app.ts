import { createHash, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { systemClock, type Clock, type TimerHandle } from '../../shared/clock.ts'
import { parseLensMessage, type LensView, type ServerMessage } from '../../shared/lens-protocol.ts'
import { decodeFrame, type AudioFrame } from '../../shared/wire.ts'
import { Session } from './catch/session.ts'
import type { ModelClient } from './llm/client.ts'
import type { Notifier } from './notify.ts'
import { createSplit, type WearerSplit } from './split/split.ts'
import { openStore, type Store } from './store.ts'
import type { SpeechToText, SttStream, SttWord } from './stt/types.ts'

// The server: GET /health, the SQLite store opened, and a WebSocket at /audio
// that accepts lens frames (shared/wire.ts), acknowledges each with the byte
// count of its PCM, and feeds them to one speech-to-text stream per session.
// Each session (catch/session.ts) lines the words up with the frames, splits
// the wearer from everyone else, catches names, and sends the lens what to
// show (shared/lens-protocol.ts); the lens sends its taps back. A lost
// speech-to-text stream hides the dot and is reopened every STT_RETRY_MS until
// the provider answers again (D37). Each session's frames and words are also
// emitted on `events`. The clock, the speech-to-text provider, the split, the
// model client and the notifier are injected, so the test harness
// (test/harness/) can stand in for the glasses, the provider, the model and
// the phone.
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
  /** Where time comes from: the system clock, or the harness's fixture clock. */
  clock?: Clock
  /** The speech-to-text provider; each /audio session opens one stream and feeds it every frame's PCM. */
  stt?: SpeechToText
  /** The wearer-versus-others split (D125); loudness by default (D126). main.ts passes CATCH_SPLIT's. */
  split?: WearerSplit
  /** The model client the detectors and the jogger writer call (P1a on). */
  model?: ModelClient
  /** Where phone notifications go (P2a on). */
  notifier?: Notifier
}

/** What the server heard, for the pipeline stages later phases hang here; `at` is the server's clock. */
export interface ServerEvents {
  frame: [{ session: number; at: number; frame: AudioFrame }]
  words: [{ session: number; at: number; words: SttWord[] }]
  sttError: [{ session: number; at: number; error: unknown }]
}

/** How soon a lost speech-to-text stream is tried again: the dot returns within this of the provider coming back (D37). */
export const STT_RETRY_MS = 1000

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
  clock: Clock
  events: EventEmitter<ServerEvents>
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
  const clock = opts.clock ?? systemClock
  const split = opts.split ?? createSplit()
  const events = new EventEmitter<ServerEvents>()
  let sessions = 0

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
    const session = ++sessions
    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
    }
    const lens = new Session({ clock, split, show: (view: LensView) => send({ type: 'show', view }) })

    // One speech-to-text stream at a time; a lost one is reopened on the clock.
    let stream: SttStream | undefined
    let attempt: object | undefined
    let retry: TimerHandle | undefined
    let closed = false
    const openStream = () => {
      retry = undefined
      if (!opts.stt || closed) return
      const mine = {}
      attempt = mine
      let lost = false
      const live = () => attempt === mine && !lost
      let opened: SttStream | undefined = undefined
      opened = opts.stt.open(
        (words) => {
          if (!live()) return
          events.emit('words', { session, at: clock.now(), words })
          lens.words(words)
        },
        (error) => {
          if (!live()) return
          lost = true
          events.emit('sttError', { session, at: clock.now(), error })
          lens.setHearing(false)
          if (stream === opened) stream = undefined
          opened?.close()
          if (!closed) retry = clock.setTimeout(openStream, STT_RETRY_MS)
        },
        () => {
          if (live()) lens.setHearing(true)
        },
      )
      if (live()) stream = opened
      else opened.close()
    }
    openStream()

    socket.on('close', () => {
      closed = true
      if (retry) clock.clearTimeout(retry)
      stream?.close()
      lens.close()
    })
    // An oversized message makes ws emit 'error' and close the socket with 1009;
    // unheard, that error would take the whole process down.
    socket.on('error', () => socket.terminate())
    socket.on('message', (data, isBinary) => {
      const bytes = data instanceof Buffer ? data : Buffer.concat(data as Buffer[])
      if (!isBinary) {
        const msg = parseLensMessage(bytes.toString('utf8'))
        if (msg?.type === 'touch' && msg.gesture === 'tap') lens.tap()
        return
      }
      try {
        const frame = decodeFrame(bytes)
        events.emit('frame', { session, at: clock.now(), frame })
        lens.frame(frame)
        stream?.sendPcm(frame.pcm)
        send({ type: 'ack', seq: frame.seq, bytes: frame.pcm.byteLength })
      } catch (err) {
        send({ type: 'error', message: (err as Error).message })
      }
    })
  })

  await new Promise<void>((resolve) => http.listen(opts.port, opts.host ?? '0.0.0.0', resolve))
  const { port } = http.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    store,
    clock,
    events,
    async close() {
      for (const client of wss.clients) client.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => http.close((err) => (err ? reject(err) : resolve())))
      store.close()
    },
  }
}
