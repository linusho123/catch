import { createHash, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { systemClock, type Clock, type TimerHandle } from '../../shared/clock.ts'
import { parseLensMessage, type LensView, type ServerMessage } from '../../shared/lens-protocol.ts'
import { decodeFrame, type AudioFrame } from '../../shared/wire.ts'
import { command, PromiseDetector } from './catch/promises.ts'
import { Session } from './catch/session.ts'
import { Transcript } from './catch/transcript.ts'
import type { ModelClient } from './llm/client.ts'
import { Outbox, promiseNotification, type Notifier } from './notify.ts'
import { phoneRoute, wearerOf } from './phone/api.ts'
import { History } from './phone/history.ts'
import { createSplit, type WearerSplit } from './split/split.ts'
import { openStore, type Store } from './store.ts'
import type { SpeechToText, SttStream, SttWord } from './stt/types.ts'

// The server: GET /health, the SQLite store opened, and a WebSocket at /audio
// that accepts lens frames (shared/wire.ts), acknowledges each with the byte
// count of its PCM, and feeds them to one speech-to-text stream per socket.
// The session (catch/session.ts) is the wearer's, not the socket's: one wearer
// per account (D79), keyed by the shared token, so a lens that loses its
// socket and comes back finds its conversation, held names and own name as it
// left them; the newest socket for a token is the one that counts, and an
// older one still open is told it cannot hear. The session lines the words up with the frames, splits
// the wearer from everyone else, catches names, and sends the lens what to
// show (shared/lens-protocol.ts); the lens sends its taps back. A lost
// speech-to-text stream hides the dot and is reopened every STT_RETRY_MS until
// the provider answers again (D37). A provider times its words from the start
// of its own stream (Deepgram: seconds from the first audio it was sent), so
// each stream's words are moved onto the session's timeline by where that
// stream's first audio sits on it before the session judges them (M1); after a
// reopen they would otherwise start again near 0, against the wrong frames.
// Each session's frames and words (on the session's timeline) are also
// emitted on `events`. The clock, the speech-to-text provider, the split, the
// model client and the notifier are injected, so the test harness
// (test/harness/) can stand in for the glasses, the provider, the model and
// the phone.
//
// /audio is public on Fly, so it takes only clients that carry the shared token
// (operator ruling 2026-10-17): the lens sends it as `?token=` (a browser
// WebSocket cannot set headers), built in from VITE_CATCH_TOKEN; the server's
// copy is the Fly secret CATCH_AUDIO_TOKEN. Neither is ever committed.
//
// The phone page (D130) reads the history and each conversation's screen from
// the read-only phone API under /phone/ (phone/api.ts), with the same token.
// Each conversation that ends is offered to the history (phone/history.ts),
// which keeps it only if it produced a promise or a keep (D76, D100), with
// the wearer's promises as commands under YOU; one with promises also sends
// its notification to the wearer's phone through the outbox (notify.ts),
// which holds it until the phone takes it (D114). The open conversation's
// transcript lives in the store until its end, and is deleted there (D76).

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
  /** The wearer's name (CATCH_WEARER_NAME, optional): never caught, whatever the split decides, beside D29's exclusion. */
  wearerName?: string
  /**
   * Automatic dropped-thread detection (D120): on by default; the operator
   * switches it off (CATCH_THREAD_DETECTION=off) after the hour-one test or
   * the shipping step's tuning, never the build. Off, no thread line comes on
   * its own and a tap at the dot gives the thread back on the held page.
   */
  threadDetection?: boolean
  /** The model client the detectors and the jogger writer call (P1a on). */
  model?: ModelClient
  /** Where phone notifications go (P2a on); without one, the phone page's history is the only way promises reach the phone. */
  notifier?: Notifier
}

/** What the server heard, for the pipeline stages later phases hang here; `at` is the server's clock. */
export interface ServerEvents {
  frame: [{ session: number; at: number; frame: AudioFrame }]
  words: [{ session: number; at: number; words: SttWord[] }]
  sttError: [{ session: number; at: number; error: unknown }]
  /** A model pass failed (under test, a missing cassette): the promise it judged is lost. */
  modelError: [{ at: number; error: unknown }]
}

/** How soon a lost speech-to-text stream is tried again: the dot returns within this of the provider coming back (D37). */
export const STT_RETRY_MS = 1000

/**
 * The largest /audio message accepted (M6). A lens frame is 16 + 3200 bytes;
 * anything far past that is refused (close 1009) before ws buffers it.
 */
export const MAX_AUDIO_MESSAGE_BYTES = 64 * 1024

const digest = (s: string) => createHash('sha256').update(s).digest()

const params = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://localhost').searchParams

function carriesToken(req: IncomingMessage, expected: Buffer): boolean {
  const given = params(req).get('token')
  return given !== null && timingSafeEqual(digest(given), expected)
}

export interface RunningServer {
  url: string
  store: Store
  clock: Clock
  events: EventEmitter<ServerEvents>
  /**
   * Drops every wearer's in-memory session and every notification waiting
   * for its phone, as a restart of the process would (P9 makes them survive
   * one). The test harness calls it between scenarios.
   */
  forgetWearers(): void
  /** The operator's D120 switch, set while the server runs: every session, open or new, reads it from the next word or tap. */
  setThreadDetection(on: boolean): void
  close(): Promise<void>
}

/** One speech-to-text stream as a session feeds it: the stream, and where its first audio starts on the session's timeline (seconds). */
interface Feed {
  stt?: SttStream
  zero?: number
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  if (!opts.audioToken) throw new Error('CATCH_AUDIO_TOKEN is not set; /audio never runs without its shared token')
  const expectedToken = digest(opts.audioToken)
  const store = openStore(opts.dbPath)
  const history = new History(store)
  const transcript = new Transcript(store)
  const clock = opts.clock ?? systemClock
  const split = opts.split ?? createSplit()
  const events = new EventEmitter<ServerEvents>()
  let threadDetection = opts.threadDetection ?? true
  const outbox = opts.notifier ? new Outbox(opts.notifier, clock) : undefined
  const promises = opts.model ? new PromiseDetector(opts.model) : undefined
  let sessions = 0
  /** One session per wearer, keyed by the digest of the shared token their lens carries (D79). */
  const wearers = new Map<string, Session>()

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
    if (phoneRoute(req, res, { history, expected: expectedToken, headers: CORS })) return
    res.writeHead(404, CORS).end()
  })

  const wss = new WebSocketServer({
    server: http,
    path: '/audio',
    maxPayload: MAX_AUDIO_MESSAGE_BYTES,
    verifyClient: (info, done) => (carriesToken(info.req, expectedToken) ? done(true) : done(false, 401, 'Unauthorized')),
  })
  wss.on('connection', (socket, req) => {
    const session = ++sessions
    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
    }
    const wearer = wearerOf(params(req).get('token') ?? '')
    const lens =
      wearers.get(wearer) ??
      new Session({
        clock,
        split,
        wearerName: opts.wearerName,
        threadDetection: () => threadDetection,
        promises,
        onModelError: (error) => {
          console.error(`a promise pass failed, so that promise is lost: ${(error as Error)?.message ?? String(error)}`)
          events.emit('modelError', { at: clock.now(), error })
        },
        transcript: { add: (word) => transcript.add(wearer, word), delete: () => transcript.delete(wearer) },
        // P4 gives the history the keep, P5 the owed promises.
        onEnd: ({ promises: said, ...ended }) => {
          const you = said.map(command)
          const id = history.record(wearer, { ...ended, you, owed: [], kept: false })
          const notification = promiseNotification(id, you)
          if (notification) outbox?.enqueue(wearer, notification)
        },
      })
    wearers.set(wearer, lens)

    // One speech-to-text stream at a time; a lost one is reopened on the clock.
    // `zero` is where the stream's first audio starts on the session's
    // timeline, set as that audio is sent; its words are moved by it (M1).
    let stream: Feed | undefined
    let attempt: object | undefined
    let retry: TimerHandle | undefined
    let closed = false
    const stopStream = () => {
      closed = true
      if (retry) clock.clearTimeout(retry)
      stream?.stt?.close()
    }
    const attachment = lens.attach((view: LensView) => send({ type: 'show', view }), {
      lens: params(req).get('lens') ?? undefined,
      onReplaced: stopStream,
    })
    const openStream = () => {
      retry = undefined
      if (!opts.stt || closed) return
      const mine: Feed = {}
      attempt = mine
      let lost = false
      const live = () => attempt === mine && !lost && attachment.active
      let opened: SttStream | undefined = undefined
      opened = opts.stt.open(
        (raw) => {
          if (!live()) return
          const zero = mine.zero ?? 0
          const words = raw.map((w) => ({ ...w, start: w.start + zero, end: w.end + zero }))
          events.emit('words', { session, at: clock.now(), words })
          lens.words(words)
        },
        (error) => {
          if (!live()) return
          lost = true
          events.emit('sttError', { session, at: clock.now(), error })
          lens.setHearing(false)
          if (stream === mine) stream = undefined
          opened?.close()
          if (!closed) retry = clock.setTimeout(openStream, STT_RETRY_MS)
        },
        () => {
          if (live()) lens.setHearing(true)
        },
      )
      mine.stt = opened
      if (live()) stream = mine
      else opened.close()
    }
    openStream()

    // The socket goes, the conversation stays (D79): the session only learns it cannot hear this lens.
    socket.on('close', () => {
      stopStream()
      attachment.detach()
    })
    // An oversized message makes ws emit 'error' and close the socket with 1009;
    // unheard, that error would take the whole process down.
    socket.on('error', () => socket.terminate())
    socket.on('message', (data, isBinary) => {
      // A socket a newer lens has replaced no longer speaks for the wearer.
      if (!attachment.active) return
      const bytes = data instanceof Buffer ? data : Buffer.concat(data as Buffer[])
      if (!isBinary) {
        const msg = parseLensMessage(bytes.toString('utf8'))
        if (msg?.type === 'touch' && msg.gesture === 'tap') lens.tap()
        if (msg?.type === 'touch' && msg.gesture === 'long-press') lens.longPress()
        if (msg?.type === 'touch' && msg.gesture === 'swipe-down') lens.swipeDown()
        return
      }
      try {
        const frame = decodeFrame(bytes)
        events.emit('frame', { session, at: clock.now(), frame })
        const startsAt = lens.frame(frame)
        if (stream) {
          stream.zero ??= startsAt
          stream.stt?.sendPcm(frame.pcm)
        }
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
    forgetWearers() {
      for (const session of wearers.values()) session.close()
      wearers.clear()
      outbox?.forget()
    },
    setThreadDetection(on) {
      threadDetection = on
    },
    async close() {
      outbox?.close()
      for (const client of wss.clients) client.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => http.close((err) => (err ? reject(err) : resolve())))
      store.close()
    },
  }
}

/**
 * CATCH_THREAD_DETECTION: `on` (the default, also when unset or empty) or
 * `off` (D120). Anything else is refused, so a typo never silently leaves the
 * operator's choice undone.
 */
export function threadDetectionFromEnv(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase()
  if (v === '' || v === 'on') return true
  if (v === 'off') return false
  throw new Error(`CATCH_THREAD_DETECTION must be on or off, got ${JSON.stringify(value)}`)
}
