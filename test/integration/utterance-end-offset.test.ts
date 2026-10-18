import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { VirtualClock } from '../harness/clock.ts'
import { pcmAt } from '../harness/player.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { createSplit } from '../../server/src/split/split.ts'
import type { SpeechToText, SttStream, SttWord } from '../../server/src/stt/types.ts'
import type { LensView, ServerMessage } from '../../shared/lens-protocol.ts'
import { encodeFrame } from '../../shared/wire.ts'

// test-gap-1 (PT): the provider's UtteranceEnd names a time on its own
// stream's clock, which starts again near 0 when a lost stream is reopened.
// The server moves it onto the session's timeline by the stream's zero, as it
// moves the stream's words (M1). Here the first stream is lost and the second
// starts ten seconds into the session: an utterance end for words before the
// wearer's unpunctuated promise leaves it alone, and the one after it ends
// the sentence, so the promise is judged and shown. Dropped, the zero would
// put every utterance end after a reconnect before the words it ends (nothing
// judged at a pause); too large, it would end a sentence the late utterance
// end is not about. Read from what the lens is sent over /audio.

const TOKEN = 'utterance-end-offset-token'
const WEARER = -12
const SAID = "Sure I'll send you the deck tonight"

/** A provider whose streams the test drives by hand: words and utterance ends on each stream's own clock. */
class HandStt implements SpeechToText {
  readonly name = 'hand'
  readonly streams: {
    onWords: (words: SttWord[]) => void
    onError: (err: unknown) => void
    onUtteranceEnd: ((lastWordEnd: number) => void) | undefined
  }[] = []

  open(onWords: (words: SttWord[]) => void, onError: (err: unknown) => void, onOpen?: () => void, onUtteranceEnd?: (lastWordEnd: number) => void): SttStream {
    this.streams.push({ onWords, onError, onUtteranceEnd })
    queueMicrotask(() => onOpen?.())
    return { sendPcm() {}, close() {} }
  }
}

const clock = new VirtualClock()
const stt = new HandStt()
const asked: string[] = []
const model: ModelClient = {
  complete(_m, prompt) {
    const said = /^The wearer now says: (.*)$/m.exec(prompt)?.[1] ?? ''
    asked.push(said)
    return Promise.resolve(JSON.stringify(said === SAID ? { promise: true, summary: 'send Dev the deck tonight' } : { promise: false }))
  },
}
let server: RunningServer

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', audioToken: TOKEN, clock, stt, split: createSplit('loudness'), model })
})
afterAll(() => server.close())

async function waitUntil(test: () => boolean, ms = 2000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 20) await clock.sleepUntil(clock.now() + 20)
}

describe("the provider's utterance end after a stream is reopened (PT, test-gap-1)", () => {
  it('is moved onto the session timeline by the new stream\'s zero, so it ends the promise it follows and no other', async () => {
    const views: { at: number; view: LensView }[] = []
    const acked = new Set<number>()
    const socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/audio?token=${TOKEN}`)
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage
      if (msg.type === 'show') views.push({ at: clock.now(), view: msg.view })
      if (msg.type === 'ack') acked.add(msg.seq)
    })
    await new Promise((resolve) => socket.on('open', resolve))
    const placed: SttWord[][] = []
    server.events.on('words', ({ words }) => placed.push(words))
    let seq = 0
    /** The wearer's loud frames from session second `from` to `to`, each stamped at its end; resolves once the server has them all. */
    const frames = async (from: number, to: number) => {
      let last = -1
      for (let t = Math.round(from * 10) + 1; t <= Math.round(to * 10); t++) {
        last = seq++
        socket.send(encodeFrame({ seq: last, captureMs: t * 100, speakerRole: 'unknown', direction: null, pcm: pcmAt(WEARER) }))
      }
      await waitUntil(() => acked.has(last))
      expect(acked.has(last), 'the server never had the frames').toBe(true)
    }
    try {
      await waitUntil(() => views.at(-1)?.view.kind === 'dot')
      // The first stream hears the first two seconds, then is lost; the server reopens one after a second.
      await frames(0, 2)
      stt.streams[0]!.onError(new Error('the provider dropped the stream'))
      await waitUntil(() => stt.streams.length === 2 && views.at(-1)?.view.kind === 'dot', 3000)
      expect(stt.streams).toHaveLength(2)
      // The second stream's first audio starts ten seconds into the session: its zero.
      await frames(10, 16)
      const second = stt.streams[1]!
      // The wearer's promise, two to about four seconds into the second stream, with no closing punctuation.
      second.onWords(SAID.split(' ').map((text, i) => ({ text, start: 2 + i * 0.3, end: 2.3 + i * 0.3, confidence: 1, speaker: null, isFinal: true })))
      expect(placed.at(-1)![0]!.start).toBeCloseTo(12, 6)
      await clock.sleepUntil(clock.now() + 100)
      expect(asked).toEqual([])
      // A late utterance end for words before the promise (second 1 of this stream, 11 of the session): the sentence goes on.
      second.onUtteranceEnd!(1)
      await clock.sleepUntil(clock.now() + 100)
      expect(asked, 'an utterance end for earlier words ended the promise').toEqual([])
      // The utterance end after "tonight" (4.1 s on this stream, 14.1 in the session): the promise is judged and shown.
      const pausedAt = clock.now()
      second.onUtteranceEnd!(2.3 + 6 * 0.3)
      const line = () => views.find((v) => v.at >= pausedAt && v.view.kind === 'line' && v.view.text === 'promised · send Dev the deck tonight')
      await waitUntil(() => line() !== undefined)
      expect(asked, 'the utterance end after the promise did not end it').toEqual([SAID])
      expect(line()).toBeDefined()
    } finally {
      socket.close()
      await new Promise((resolve) => socket.on('close', resolve))
    }
  })
})
