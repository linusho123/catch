import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { SafeModelError } from '../../server/src/llm/errors.ts'
import { NOTIFY_RETRY_MS } from '../../server/src/notify.ts'
import type { SpeechToText, SttWord } from '../../server/src/stt/types.ts'
import type { LensView, ServerMessage } from '../../shared/lens-protocol.ts'
import { encodeFrame } from '../../shared/wire.ts'
import { VirtualClock } from '../harness/clock.ts'
import { NotificationCapture } from '../harness/notifications.ts'
import { pcmAt } from '../harness/player.ts'
import { find, rows } from '../harness/store-reader.ts'
import { audioProtocols } from '../../shared/audio-token.ts'

// Fix round, test-3: a kept conversation whose jogger pass fails. The
// transcript is already gone (D76), so the conversation stays kept with no
// jogger: the failure is reported as a model error (logged without a word of
// the conversation, head-log-1), no jogger is stored, no kept notification is
// queued (now or on any retry), the store holds no transcript, and the server
// goes on serving. Read from the store file and the notification capture,
// never from the server's own account.

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

/** A model whose jogger pass fails; a promise pass (none is expected) finds no promise. */
const joggerFails: ModelClient = {
  complete: async (_model, prompt) => {
    if (prompt.includes('memory jogger')) throw new SafeModelError('Gemini answered 503')
    return '{"promise": false}'
  },
}

const servers: RunningServer[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  for (const s of servers.splice(0)) await s.close().catch(() => {})
  vi.restoreAllMocks()
})

describe('a kept conversation whose jogger pass fails (test-3)', () => {
  it('reports a model error, stores no jogger, queues no kept notification, keeps no transcript, and goes on serving', async () => {
    const logged: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
    const dbPath = join(mkdtempSync(join(tmpdir(), 'catch-jogger-failure-')), 'catch.db')
    const { stt, say } = scriptedStt()
    const clock = new VirtualClock(1)
    const notifications = new NotificationCapture(clock)
    const server = await startServer({ port: 0, host: '127.0.0.1', dbPath, audioToken: TOKEN, clock, stt, model: joggerFails, notifier: notifications })
    servers.push(server)
    const modelErrors: unknown[] = []
    server.events.on('modelError', ({ error }) => modelErrors.push(error))

    const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?lens=jogger-failure`, audioProtocols(TOKEN))
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

    // The wearer speaks (loud frames, the loudness split): the conversation begins and its words are in the store.
    const tokens = 'The Zanzibar plan is ready.'.split(' ')
    const frames = Math.ceil((tokens.length * 0.3 + 0.2) / FRAME_S)
    for (let seq = 0; seq < frames; seq++) {
      socket.send(encodeFrame({ seq, captureMs: (seq + 1) * FRAME_S * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(WEARER_DBFS) }))
    }
    await until('every frame acknowledged', () => acks === frames)
    say(tokens.map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.3, confidence: 1, speaker: null, isFinal: true })))
    await until('the words reached the store', () => find(dbPath, 'Zanzibar').length > 0)
    await until('the dot is up', () => views.at(-1)?.kind === 'dot')

    // A swipe up, a tap: kept (D40, D111); the "kept" line runs its second and a half; then a long-press ends it (D52).
    socket.send(JSON.stringify({ type: 'touch', gesture: 'swipe-up' }))
    await until('the keep prompt', shown('keep this conversation?'))
    socket.send(JSON.stringify({ type: 'touch', gesture: 'tap' }))
    await until('"kept"', shown('kept'))
    clock.advance(2000)
    await until('the dot after "kept"', () => views.at(-1)?.kind === 'dot')
    socket.send(JSON.stringify({ type: 'touch', gesture: 'long-press' }))
    await until('the jogger pass failed and was reported', () => modelErrors.length > 0)

    // The conversation is on the history, kept, with no jogger in the store.
    const conversations = rows(dbPath, 'conversations')
    expect(conversations.map((r) => Number(r.kept)), 'the conversation is recorded, kept').toEqual([1])
    expect(rows(dbPath, 'joggers'), 'no jogger is stored').toEqual([])
    // No kept notification, not now and not on a retry (no promise was made, so nothing at all).
    clock.advance(NOTIFY_RETRY_MS * 3)
    await new Promise((r) => setTimeout(r, 20))
    expect([...notifications.received, ...notifications.refused].map((c) => c.notification.body), 'no notification was queued').toEqual([])
    // Its transcript is gone (D76): no row, and the words in no table.
    expect(rows(dbPath, 'transcript'), 'no transcript row').toEqual([])
    expect(find(dbPath, 'Zanzibar'), "the conversation's words in any table").toEqual([])
    // One model error, logged without a word of the conversation.
    expect(modelErrors, 'one model error, the jogger pass').toHaveLength(1)
    expect(logged.some((l) => /jogger could not be written/.test(l)), 'the failure is logged').toBe(true)
    for (const line of logged) expect(line).not.toMatch(/zanzibar/i)

    // The server goes on serving: its health answers, and the wearer's next words begin a new conversation.
    expect((await fetch(`${server.url}/health`)).status).toBe(200)
    expect(socket.readyState, 'the lens is still connected').toBe(WebSocket.OPEN)
    const more = Math.ceil(1.2 / FRAME_S)
    for (let k = 0; k < more; k++) {
      socket.send(encodeFrame({ seq: frames + k, captureMs: (frames + k + 1) * FRAME_S * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(WEARER_DBFS) }))
    }
    await until('the next frames acknowledged', () => acks === frames + more)
    const from = frames * FRAME_S
    say(['Next', 'topic', 'then.'].map((t, i) => ({ text: t, start: from + i * 0.3, end: from + i * 0.3 + 0.3, confidence: 1, speaker: null, isFinal: true })))
    await until('the next words reached the store', () => find(dbPath, 'topic').length > 0)
  })
})
