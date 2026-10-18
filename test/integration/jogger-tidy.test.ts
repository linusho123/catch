import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { SafeModelError } from '../../server/src/llm/errors.ts'
import { JOGGER_BUDGET_MS, type TidyOutcome } from '../../server/src/catch/jogger.ts'
import type { SpeechToText, SttWord } from '../../server/src/stt/types.ts'
import type { LensView, ServerMessage } from '../../shared/lens-protocol.ts'
import { encodeFrame } from '../../shared/wire.ts'
import { VirtualClock } from '../harness/clock.ts'
import { NotificationCapture } from '../harness/notifications.ts'
import { pcmAt } from '../harness/player.ts'
import { find, rows } from '../harness/store-reader.ts'

// P7: a kept conversation's tidy pass on the running server. Tidied, its
// answer is the jogger stored; failed, or still out when D116's thirty seconds
// run out, the first draft is stored as it is, the kept notification comes
// all the same within the thirty seconds, the transcript is gone (D76), and
// the log says why without a word of the conversation (head-log-1). Read from
// the store file and the notification capture, never the server's own account.

const TOKEN = 'jogger-failure-test-token-not-a-secret'
const WEARER_DBFS = -12
const FRAME_S = 0.1

/** A speech-to-text stand-in whose words the test hands over. */
function scriptedStt() {
  let deliver: ((words: SttWord[]) => void) | undefined
  const stt: SpeechToText = {
    name: 'scripted',
    open(onWords, _onError, onOpen) {
      deliver = onWords
      queueMicrotask(() => onOpen?.())
      return { sendPcm() {}, close() {} }
    },
  }
  return { stt, say: (words: SttWord[]) => deliver!(words) }
}

const DRAFT = JSON.stringify({ bullets: [{ line: 1, text: 'The **Zanzibar** plan is, like, ready.' }] })
const FIRST = ['The **Zanzibar** plan is, like, ready.']
const TIDIED = ['The **Zanzibar** plan is ready.']

/** A model whose first jogger pass answers DRAFT and whose tidy pass does `tidy`; a promise pass (none is expected) finds no promise. */
const model = (tidy: () => Promise<string>): ModelClient => ({
  complete: async (_model, prompt) => {
    if (prompt.startsWith('You tidy')) return tidy()
    if (prompt.includes('memory jogger')) return DRAFT
    return '{"promise": false}'
  },
})

const servers: RunningServer[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  for (const s of servers.splice(0)) await s.close().catch(() => {})
  vi.restoreAllMocks()
})

/**
 * Plays one kept conversation ("The Zanzibar plan is ready.") and ends it with
 * a long-press; resolves at the end, on the clock. With `minutes`, the wearer
 * says "Okay." every nine minutes, so its quiet never ends it (D92), until it
 * has run that long, and only then keeps it.
 */
async function keptConversation(tidy: () => Promise<string>, minutes = 0) {
  const logged: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
  const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-jogger-tidy-')), 'catch.db')
  const { stt, say } = scriptedStt()
  const clock = new VirtualClock(1e-6)
  const notifications = new NotificationCapture(clock)
  const server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, clock, stt, model: model(tidy), notifier: notifications })
  servers.push(server)
  const modelErrors: unknown[] = []
  const tidies: TidyOutcome[] = []
  server.events.on('modelError', ({ error }) => modelErrors.push(error))
  server.events.on('joggerTidy', ({ outcome }) => tidies.push(outcome))
  const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?token=${TOKEN}&lens=jogger-tidy`)
  sockets.push(socket)
  const views: LensView[] = []
  let acks = 0
  socket.on('message', (data) => {
    const msg = JSON.parse(String(data)) as ServerMessage
    if (msg.type === 'show') views.push(msg.view)
    if (msg.type === 'ack') acks++
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  const until = async (what: string, ok: () => boolean) => {
    for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5))
    expect(ok(), what).toBe(true)
  }
  const shown = (text: string) => () => views.some((v) => v.kind === 'line' && v.text === text)
  let seq = 0
  /** The wearer says `text` from second `at` of the stream: its frames, acknowledged, then its words. */
  const speak = async (text: string, at: number) => {
    const tokens = text.split(' ')
    const frames = Math.ceil((tokens.length * 0.3 + 0.2) / FRAME_S)
    const sent = acks + frames
    for (let i = 0; i < frames; i++) {
      socket.send(encodeFrame({ seq: seq++, captureMs: (at + (i + 1) * FRAME_S) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(WEARER_DBFS) }))
    }
    await until('every frame acknowledged', () => acks === sent)
    say(tokens.map((t, i) => ({ text: t, start: at + i * 0.3, end: at + i * 0.3 + 0.3, confidence: 1, speaker: null, isFinal: true })))
  }
  await speak('The Zanzibar plan is, like, ready.', 0)
  await until('the words reached the store', () => find(dbPath, 'Zanzibar').length > 0)
  await until('the dot is up', () => views.at(-1)?.kind === 'dot')
  for (let at = 9 * 60; at < minutes * 60; at += 9 * 60) {
    clock.advance(at * 1000 - clock.now())
    const before = rows(dbPath, 'transcript').length
    await speak('Okay.', at)
    await until('"Okay." reached the store', () => rows(dbPath, 'transcript').length > before)
  }
  if (minutes > 0) clock.advance(minutes * 60_000 - clock.now())
  socket.send(JSON.stringify({ type: 'touch', gesture: 'swipe-up' }))
  await until('the keep prompt', shown('keep this conversation?'))
  socket.send(JSON.stringify({ type: 'touch', gesture: 'tap' }))
  await until('"kept"', shown('kept'))
  clock.advance(2000)
  await until('the dot after "kept"', () => views.at(-1)?.kind === 'dot')
  const endedAt = clock.now()
  socket.send(JSON.stringify({ type: 'touch', gesture: 'long-press' }))
  await until('the conversation ended', () => rows(dbPath, 'conversations').length === 1)
  /** The jogger in the store, the kept notifications the phone received with their time from the end, the transcript left. */
  const after = () => ({
    jogger: rows(dbPath, 'joggers').map((r) => JSON.parse(String(r.bullets)) as string[]),
    kept: notifications.received.filter((c) => c.notification.data?.screen === 'jogger').map((c) => c.at - endedAt),
    transcript: rows(dbPath, 'transcript'),
  })
  return { clock, until, after, logged, modelErrors, tidies, dbPath }
}

describe("a kept conversation's tidy pass (P7)", () => {
  it('stores the tidied draft when the tidy pass answers', async () => {
    const k = await keptConversation(async () => JSON.stringify({ bullets: TIDIED }))
    await k.until('the jogger is stored', () => k.after().jogger.length > 0)
    expect(k.after().jogger).toEqual([TIDIED])
    expect(k.tidies).toEqual([{ tidied: true }])
    await k.until('the kept notification', () => k.after().kept.length > 0)
    expect(k.after().transcript).toEqual([])
  })

  it('stores the first draft when the tidy pass fails, with the kept notification and no transcript, logged without the conversation', async () => {
    const k = await keptConversation(() => Promise.reject(new SafeModelError('Gemini answered 503')))
    await k.until('the kept notification', () => k.after().kept.length > 0)
    expect(k.after().jogger, 'the first draft, unchanged').toEqual([FIRST])
    expect(k.after().kept[0], 'within the thirty seconds').toBeLessThanOrEqual(JOGGER_BUDGET_MS)
    expect(k.after().transcript, 'no transcript row').toEqual([])
    expect(find(k.dbPath, 'like,'), 'the words in no table but the jogger').toEqual([{ table: 'joggers', column: 'bullets', value: JSON.stringify(FIRST) }])
    expect(k.tidies.map((o) => (o.tidied ? 'tidied' : o.why))).toEqual(['failed'])
    expect(k.modelErrors, 'the failure is a model error').toHaveLength(1)
    expect(k.logged.some((l) => /tidy pass was skipped, so its first draft is stored: it failed/.test(l)), 'logged').toBe(true)
    for (const line of k.logged) expect(line).not.toMatch(/zanzibar|like/i)
  })

  // Operator answer 3: from an hour, both passes share D116's "a few minutes", read as three; the server gives the pass the conversation's length.
  it('gives the tidy pass of a conversation of an hour or more three minutes, and one under an hour thirty seconds', async () => {
    for (const [minutes, tidied] of [
      [61, true],
      [50, false],
    ] as const) {
      let answer!: (s: string) => void
      let asked = false
      const k = await keptConversation(
        () =>
          new Promise<string>((r) => {
            asked = true
            answer = r
          }),
        minutes,
      )
      const conversation = rows(k.dbPath, 'conversations')[0]!
      expect((Number(conversation.ended_at) - Number(conversation.started_at)) / 60_000, `a ${minutes}-minute conversation`).toBeCloseTo(minutes, 0)
      await k.until('the tidy pass is asked', () => asked)
      k.clock.advance(60_000)
      answer(JSON.stringify({ bullets: TIDIED }))
      await k.until('the jogger is stored', () => k.after().jogger.length > 0)
      expect(k.after().jogger, `a tidy answering a minute after the end of a ${minutes}-minute conversation`).toEqual([tidied ? TIDIED : FIRST])
      expect(k.tidies.map((o) => (o.tidied ? 'tidied' : o.why)), `${minutes} minutes`).toEqual([tidied ? 'tidied' : 'late'])
      for (const s of sockets.splice(0)) s.terminate()
      for (const s of servers.splice(0)) await s.close().catch(() => {})
      vi.restoreAllMocks()
    }
  })

  it('stores the first draft when the tidy pass has not answered as the thirty seconds run out, and not a moment before', async () => {
    const k = await keptConversation(() => new Promise<string>(() => {}))
    await k.until('the tidy pass is out', () => k.tidies.length === 0 && k.after().jogger.length === 0)
    k.clock.advance(JOGGER_BUDGET_MS - 100)
    await new Promise((r) => setTimeout(r, 20))
    expect(k.after().jogger, 'nothing stored before the thirty seconds').toEqual([])
    k.clock.advance(100)
    await k.until('the first draft is stored', () => k.after().jogger.length > 0)
    expect(k.after().jogger).toEqual([FIRST])
    await k.until('the kept notification', () => k.after().kept.length > 0)
    // At the thirty seconds: measured from just before the long-press was sent, on a clock that drifts by nanoseconds meanwhile.
    expect(k.after().kept[0], 'within the thirty seconds').toBeLessThanOrEqual(JOGGER_BUDGET_MS + 0.001)
    expect(k.after().transcript).toEqual([])
    expect(k.tidies.map((o) => (o.tidied ? 'tidied' : o.why))).toEqual(['late'])
    expect(k.modelErrors, 'a late tidy is no model error').toEqual([])
    for (const line of k.logged) expect(line).not.toMatch(/zanzibar|like/i)
  })
})
