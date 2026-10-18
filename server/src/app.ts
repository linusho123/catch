import { createHash, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { systemClock, type Clock, type TimerHandle } from '../../shared/clock.ts'
import { parseLensMessage, type LensView, type ServerMessage } from '../../shared/lens-protocol.ts'
import { decodeFrame, type AudioFrame } from '../../shared/wire.ts'
import { writeKeptJogger, type TidyOutcome } from './catch/jogger.ts'
import { command, PromiseDetector } from './catch/promises.ts'
import { SavedSessions } from './catch/saved-sessions.ts'
import { Session, type SessionState } from './catch/session.ts'
import { Transcript } from './catch/transcript.ts'
import type { ModelClient } from './llm/client.ts'
import { SafeModelError } from './llm/errors.ts'
import { checkedTimeZone, keptNotification, Outbox, promiseNotification, type Notifier } from './notify.ts'
import { StoredOutbox } from './notify-store.ts'
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
// the phone API under /phone/ (phone/api.ts), with the same token, ticks
// promises off there (P7, D133), and deletes a conversation there (D134):
// its history row, names, promises, ticks and jogger, and every notification
// still waiting in the outbox for it, in one transaction, then the file is
// scrubbed as an ended conversation's transcript is (secure_delete, the
// write-ahead log truncated); a jogger still being written for it is
// cancelled, so nothing of it is stored or sent after. Deleting touches no
// session and no lens.
// Each conversation that ends is offered to the history (phone/history.ts),
// which keeps it only if it produced a promise or a keep (D76, D100), with
// the wearer's promises as commands under YOU; one with promises also sends
// its notification to the wearer's phone through the outbox (notify.ts),
// which holds it until the phone takes it (D114). The open conversation's
// transcript lives in the store until its end, and is deleted there (D76).
// Nothing the server logs about a model pass quotes the conversation
// (head-log-1).
//
// A restart (P9, D73): each wearer's session hands the store its state after
// every change (catch/saved-sessions.ts), and the outbox keeps what waits for
// a phone there too (notify-store.ts). As the server starts, before it takes
// a socket, it builds every wearer's session again from the store, so a lens
// that comes back (the same launch reconnecting, or the Even app started
// again) re-attaches to the open conversation, with its names, promises,
// keep mark and transcript, and never starts a second one; the quiet rule
// runs on across the restart, so a conversation whose ten minutes ran out
// while no server ran ends as it is built, and its transcript goes (D92,
// D76). Every transcript row that belongs to no open conversation is deleted
// as the server starts (P2a's purge of every row at start, which this
// replaces). The outbox's waiting notifications are tried again at once.
//
// A kept conversation (P4): as it ends, its history row is written kept, its
// promise notification (if any) is queued, and its jogger is written from the
// transcript the session hands on (catch/jogger.ts, D24, D99), then tidied by
// a second pass on the same transcript within the same thirty seconds (P7, a
// `chosen` change; a tidy that fails, is late or breaks the draft's structure
// leaves the first draft, logged without a word of the conversation). The
// store's copy of the transcript is already gone by then (D76); the words
// live only in those passes until the jogger is stored, and then go too. Once stored, the
// kept notification is queued behind the promise one, and waits for the
// phone the same way (D114). A pass that fails is reported (modelError) and
// leaves the conversation kept with no jogger; a pass still out when the
// wearers are forgotten or the server closes is cancelled, and its answer
// touches nothing.

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
  /** The wearer's time zone (CATCH_TIME_ZONE), for a kept notification that names the time because no name was caught; the server's own when unset. */
  timeZone?: string
  /**
   * Further accounts' shared tokens, each its own wearer (D79). Production
   * serves one account and passes none; the test harness signs a second
   * account in, so a notification sent to the wrong phone shows (test-2).
   */
  otherAudioTokens?: readonly string[]
}

/** What the server heard, for the pipeline stages later phases hang here; `at` is the server's clock. */
export interface ServerEvents {
  frame: [{ session: number; at: number; frame: AudioFrame }]
  words: [{ session: number; at: number; words: SttWord[] }]
  sttError: [{ session: number; at: number; error: unknown }]
  /** A model pass failed (under test, a missing cassette): the promise it judged is lost. */
  modelError: [{ at: number; error: unknown }]
  /** A model pass had not answered within D89's three seconds: a promise it finds is held without a line (answer 9). */
  modelLate: [{ at: number }]
  /** A conversation's end could not be handed on (its history record or notification); the conversation has ended all the same (risk-3). */
  endError: [{ at: number; error: unknown }]
  /** A kept conversation's tidy pass (P7): tidied, or why its first draft was stored as it is. */
  joggerTidy: [{ at: number; conversation: number; outcome: TidyOutcome }]
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

function carriesToken(req: IncomingMessage, expected: readonly Buffer[]): boolean {
  const given = params(req).get('token')
  if (given === null) return false
  const d = digest(given)
  return expected.some((e) => timingSafeEqual(d, e))
}

/**
 * What the log says of a failure that may have come from a model pass: a
 * SafeModelError's own words, and of anything else only its kind, because
 * any other message may quote the prompt or the answer, and both come from
 * the conversation (fix round, head-log-1; D76).
 */
export function loggable(error: unknown): string {
  if (error instanceof SafeModelError) return error.message
  return error instanceof Error ? error.name : typeof error
}

export interface RunningServer {
  url: string
  store: Store
  clock: Clock
  events: EventEmitter<ServerEvents>
  /**
   * Drops every wearer's session and every notification waiting for its
   * phone, in memory and in the store, with every open conversation's
   * transcript: the test harness's clean slate between scenarios. Not a
   * restart: a restart (close, then start on the same store) keeps them (P9).
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
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  if (!opts.audioToken) throw new Error('CATCH_AUDIO_TOKEN is not set; /audio never runs without its shared token')
  const expectedTokens = [opts.audioToken, ...(opts.otherAudioTokens ?? [])].map(digest)
  const store = openStore(opts.dbPath)
  const history = new History(store)
  const transcript = new Transcript(store)
  const saved = new SavedSessions(store)
  // P9: what the last process left. A transcript row no open conversation owns has ended with its conversation, and goes (D76).
  const left = saved.all()
  transcript.purgeExcept(saved.open())
  const clock = opts.clock ?? systemClock
  const split = opts.split ?? createSplit()
  const events = new EventEmitter<ServerEvents>()
  let threadDetection = opts.threadDetection ?? true
  // The outbox's table is opened with or without a notifier, so a delete (D134) always reaches what a previous process left waiting.
  const waiting = new StoredOutbox(store)
  const outbox = opts.notifier ? new Outbox(opts.notifier, clock, waiting) : undefined
  // CATCH_TIME_ZONE, checked once as the server starts (risk-2).
  const timeZone = checkedTimeZone(opts.timeZone)
  const promises = opts.model ? new PromiseDetector(opts.model) : undefined
  let sessions = 0
  /** Joggers being written, by conversation, each cancelled when the wearers are forgotten, the server closes, or its conversation is deleted (D134). */
  const writing = new Map<AbortController, number>()
  const stopJoggers = () => {
    for (const abort of writing.keys()) abort.abort()
    writing.clear()
  }
  /**
   * One of the wearer's conversations deleted on the phone page (D134):
   * everything the store holds of it, its waiting notifications included, in
   * one transaction; then its waiting notifications leave the outbox's
   * memory, a jogger still being written for it is cancelled, and the file is
   * scrubbed. Another wearer's is refused and nothing changes.
   */
  const deleteConversation = (wearer: string, id: number) => {
    const outcome = history.delete(wearer, id, () => waiting.removeConversation(wearer, id))
    if (outcome !== 'deleted') return outcome
    outbox?.dropConversation(wearer, id)
    for (const [abort, conversation] of writing) {
      if (conversation !== id) continue
      abort.abort()
      writing.delete(abort)
    }
    store.scrub()
    return outcome
  }
  /** One session per wearer, keyed by the digest of the shared token their lens carries (D79). */
  const wearers = new Map<string, Session>()

  /**
   * One wearer's session (D79), built fresh or from what the store kept of it
   * (P9): every change goes back to the store, so a restart finds it.
   */
  const makeSession = (wearer: string, state?: SessionState): Session =>
    new Session({
      clock,
      split,
      ...(state ? { saved: state } : {}),
      persist: (next) => saved.save(wearer, next),
      onSaveError: (error) => console.error(`a session's state could not be saved, so a restart would lose it: ${loggable(error)}`),
      wearerName: opts.wearerName,
      threadDetection: () => threadDetection,
      promises,
      onModelError: (error) => {
        console.error(`a promise pass failed, so that promise is lost: ${loggable(error)}`)
        events.emit('modelError', { at: clock.now(), error })
      },
      onLatePass: () => {
        console.warn('a promise pass had not answered within three seconds (D89): a promise it finds is held without a line')
        events.emit('modelLate', { at: clock.now() })
      },
      onEndError: (error) => {
        console.error(`a conversation's end could not be recorded: ${loggable(error)}`)
        events.emit('endError', { at: clock.now(), error })
      },
      transcript: { add: (word) => transcript.add(wearer, word), words: () => transcript.words(wearer), delete: () => transcript.delete(wearer) },
      // The wearer's promises as commands, and those owed to the wearer (P5), go to the history and the notification.
      onEnd: ({ promises: said, promiseTimes, kept, transcript: words, gaps, owed, ...ended }) => {
        const you = said.map(command)
        const id = history.record(wearer, { ...ended, you, owed: owed.map(command), kept })
        const notification = promiseNotification(id, you, owed)
        if (notification) outbox?.enqueue(wearer, notification)
        if (!kept || id === undefined) return
        if (!opts.model) {
          console.error('a kept conversation ended with no model to write its jogger (GEMINI_API_KEY is not set)')
          return
        }
        const abort = new AbortController()
        writing.set(abort, id)
        const onTidy = (outcome: TidyOutcome) => {
          if (abort.signal.aborted) return
          events.emit('joggerTidy', { at: clock.now(), conversation: id, outcome })
          if (outcome.tidied || outcome.why === 'nothing to tidy') return
          const why = outcome.why === 'rejected' ? `its answer was rejected (${outcome.reason})` : outcome.why === 'failed' ? `it failed: ${loggable(outcome.error)}` : outcome.why === 'late' ? 'it had not answered within the time D116 gives' : 'the first pass had used the time D116 gives'
          console.warn(`a kept conversation's jogger tidy pass was skipped, so its first draft is stored: ${why}`)
          // A failed pass is a model error like any other: under test, a missing cassette fails loudly.
          if (outcome.why === 'failed') events.emit('modelError', { at: clock.now(), error: outcome.error })
        }
        writeKeptJogger(opts.model, { names: ended.names, transcript: words, promises: said, promiseTimes, gaps }, { clock, signal: abort.signal, onTidy, conversationMs: ended.endedAt - ended.startedAt })
          .then((jogger) => {
            if (abort.signal.aborted) return
            history.recordJogger(id, jogger.bullets)
            outbox?.enqueue(wearer, keptNotification(id, ended.names, ended.startedAt, timeZone))
          })
          .catch((error: unknown) => {
            if (abort.signal.aborted) return
            console.error(`a kept conversation's jogger could not be written: ${loggable(error)}`)
            events.emit('modelError', { at: clock.now(), error })
          })
          .finally(() => writing.delete(abort))
      },
    })

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
    if (phoneRoute(req, res, { history, expected: expectedTokens, headers: CORS, remove: deleteConversation })) return
    res.writeHead(404, CORS).end()
  })

  const wss = new WebSocketServer({
    server: http,
    path: '/audio',
    maxPayload: MAX_AUDIO_MESSAGE_BYTES,
    verifyClient: (info, done) => (carriesToken(info.req, expectedTokens) ? done(true) : done(false, 401, 'Unauthorized')),
  })
  wss.on('connection', (socket, req) => {
    const session = ++sessions
    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
    }
    const wearer = wearerOf(params(req).get('token') ?? '')
    const lens = wearers.get(wearer) ?? makeSession(wearer)
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
        // PT: the provider heard a second with no words; its time is the stream's, moved like its words.
        (lastWordEnd) => {
          if (live()) lens.utteranceEnd(lastWordEnd + (mine.zero ?? 0))
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
        if (msg?.type === 'touch' && msg.gesture === 'swipe-up') lens.swipeUp()
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

  // P9: every wearer the last process held, taken up again before any socket is taken, so a lens that comes back finds its conversation and never begins a second.
  // The waiting notifications are queued first: a conversation ended as it is taken up (its quiet ran out while no server ran) enqueues its own, and resuming after it would queue that one twice (contract-1, D114).
  outbox?.resume()
  for (const { wearer, state } of left) wearers.set(wearer, makeSession(wearer, state))

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
      stopJoggers()
      outbox?.forget()
      // The forgotten sessions go from the store, and their open conversations' transcripts with them (D76).
      saved.clear()
      transcript.purge()
    },
    setThreadDetection(on) {
      threadDetection = on
    },
    async close() {
      // No session hands anything on after this (a deferred end, a quiet timer), so nothing touches the store once it is closed (risk-3).
      // Each saves its state as it closes: the open conversation waits in the store for the next process (P9).
      for (const session of wearers.values()) session.close()
      wearers.clear()
      stopJoggers()
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
