import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { ModelClient } from '../llm/client.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { PromiseDetector } from './promises.ts'
import { LINE_MS, PAGE_MS, PROMISE_MS, QUIET_MS, Session, type EndedConversation, type SessionOptions } from './session.ts'
import type { TranscriptWord } from './transcript.ts'

// The session's promises (P2a) on their own: a sentence of the wearer's goes
// to the detector, a promise shows for a second and a half and is held, a
// swipe down on the names page turns to the promises page, the end waits for
// every pass in flight, and the transcript is deleted at the boundary (D76).
// The model here answers by the sentence it is asked about, at once or when
// the test lets it.

const WEARER = -12
const OTHER = -28

/** A model that answers from `answers` by the sentence judged; `hold` keeps every answer until `release()`. */
function fakeModel(answers: Record<string, string | undefined>, hold = false) {
  const asked: string[] = []
  const waiting: (() => void)[] = []
  const model: ModelClient = {
    complete(_m, prompt) {
      const said = /^The wearer now says: (.*)$/m.exec(prompt)![1]!
      asked.push(said)
      const summary = answers[said]
      const response = JSON.stringify(summary === undefined ? { promise: false } : { promise: true, summary })
      if (!hold) return Promise.resolve(response)
      return new Promise((resolve) => waiting.push(() => resolve(response)))
    },
  }
  return { model, asked, release: () => waiting.splice(0).forEach((go) => go()) }
}

// A test that asserts a boundary to the millisecond passes a near-frozen speed, so only advance() moves
// the clock and wall time spent between steps (a busy machine) cannot cross the boundary.
function setup(model: ModelClient, opts: Partial<SessionOptions> = {}, speed = 1) {
  const clock = new VirtualClock(speed)
  const views: { at: number; view: LensView }[] = []
  const ended: EndedConversation[] = []
  const stored: TranscriptWord[] = []
  const session = new Session({
    clock,
    split: loudnessSplit(),
    show: (view) => views.push({ at: clock.now(), view }),
    promises: new PromiseDetector(model),
    onEnd: (e) => ended.push(e),
    transcript: { add: (w) => stored.push(w), delete: () => stored.splice(0) },
    ...opts,
  })
  let seq = 0
  const frame = (end: number, dbfs: number) => session.frame({ seq: seq++, captureMs: end * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  const say = (text: string, start: number, dbfs: number) => {
    const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) frame(t / 10, dbfs)
    clock.advance(Math.max(0, words.at(-1)!.end * 1000 - clock.now()))
    session.words(words)
  }
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  return { clock, session, views, ended, stored, say, settle }
}

const lineViews = (views: { view: LensView }[]) => views.flatMap(({ view }) => (view.kind === 'line' ? [view.text] : []))

describe("a session's promises", () => {
  it('shows a promise of the wearer\'s as `promised · …` for a second and a half, and holds it (D89)', async () => {
    const { model, asked } = fakeModel({ "I'll send you the deck tonight.": 'send Dev the deck tonight' })
    const { session, views, say, settle, clock } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say('Are you free tonight?', 3, OTHER)
    say("I'll send you the deck tonight.", 5, WEARER)
    await settle()
    expect(asked).toEqual(["I'll send you the deck tonight."])
    const line = views.findLast((v) => v.view.kind === 'line')!
    expect(line.view).toEqual({ kind: 'line', text: 'promised · send Dev the deck tonight' })
    clock.advance(LINE_MS)
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    session.tap()
    session.swipeDown()
    expect(views.at(-1)!.view).toEqual({ kind: 'promises', you: ['send Dev the deck tonight'] })
  })

  it("never asks about someone else's sentences, nor about the wearer's with no commitment in them", async () => {
    const { model, asked } = fakeModel({})
    const { session, say, settle } = setup(model)
    session.setHearing(true)
    say("Sure, I'll send you the agenda.", 0, OTHER)
    say('Sounds good to me.', 3, WEARER)
    await settle()
    expect(asked).toEqual([])
  })

  it('turns the names page to the promises page on a swipe down, `no promises yet` when none, for five seconds (D43, D112)', async () => {
    const { model } = fakeModel({})
    const { session, views, say, clock } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Priya.", 0, OTHER)
    clock.advance(LINE_MS)
    // A swipe at the dot means nothing yet (P6 pauses there).
    session.swipeDown()
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    session.tap()
    clock.advance(PAGE_MS - 1000)
    session.swipeDown()
    expect(views.at(-1)!.view).toEqual({ kind: 'promises', you: [] })
    // The swipe is a touch: the promises page has its own five seconds.
    clock.advance(PAGE_MS - 1)
    expect(views.at(-1)!.view.kind).toBe('promises')
    clock.advance(1)
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
    session.swipeDown()
    expect(views.at(-1)!.view).toEqual({ kind: 'dot' })
  })

  it('ends a conversation with its promises in the order said, once every pass in flight has answered, and shows none after the end', async () => {
    const { model, release } = fakeModel({ "I'll send you the deck.": 'send Dev the deck', "I'll intro you to Sam.": 'introduce Dev to Sam' }, true)
    const { session, views, ended, say, settle } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck.", 2, WEARER)
    say("I'll intro you to Sam.", 5, WEARER)
    session.longPress()
    await settle()
    expect(ended, 'the end waits for the passes').toEqual([])
    release()
    await settle()
    expect(ended.map((e) => [e.names, e.promises])).toEqual([[['Dev'], ['send Dev the deck', 'introduce Dev to Sam']]])
    expect(lineViews(views), 'no promise line after the conversation ended').toEqual(['Dev'])
  })

  it('ends at once, on the clock, when no pass is in flight; a sentence cut short by the end is still judged', async () => {
    const { model } = fakeModel({ "I'll call you": 'call Dev' })
    const { session, ended, say, settle, clock } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("Nice. I'll call you", 2, WEARER)
    clock.advance(QUIET_MS)
    await settle()
    expect(ended.map((e) => e.promises)).toEqual([['call Dev']])
  })

  it('holds the transcript while the conversation runs and deletes it at the end, here and in its store (D76)', async () => {
    const { model } = fakeModel({})
    const { session, stored, say, clock, settle } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say('Long, but worth it.', 3, OTHER)
    expect(stored.map((w) => w.text)).toEqual(['Morning,', 'how', 'was', 'the', 'trip?', 'Long,', 'but', 'worth', 'it.'])
    expect(stored.map((w) => w.side)).toEqual([...Array(5).fill('wearer'), ...Array(4).fill('other')])
    clock.advance(QUIET_MS)
    await settle()
    expect(stored).toEqual([])
  })

  it("asks the next conversation's first pass with nothing of the last one in its context (D76)", async () => {
    const prompts: string[] = []
    const model: ModelClient = {
      async complete(_m, prompt) {
        prompts.push(prompt)
        return '{"promise": false}'
      },
    }
    const { session, say, settle } = setup(model)
    session.setHearing(true)
    say('The secret plan is ready.', 0, WEARER)
    session.longPress()
    say("I'll think about it.", 5, WEARER)
    await settle()
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('secret')
    expect(prompts[0]).toContain('(nothing yet)')
  })

  // Fix round, head-test-gap-1 (probe H1): the promises page lists the wearer's promises in the order made (D43, D89).
  it('lists two promises on the promises page in the order they were made, as the lens was sent them (H1)', async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send Dev the deck tonight', "I'll intro you to Sam.": 'introduce Dev to Sam', "I'll book the room.": 'book the room' })
    const { session, views, say, settle, clock } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck tonight.", 3, WEARER)
    await settle()
    clock.advance(LINE_MS)
    say("I'll intro you to Sam.", 6, WEARER)
    await settle()
    clock.advance(LINE_MS)
    say("I'll book the room.", 9, WEARER)
    await settle()
    clock.advance(LINE_MS)
    await settle()
    expect(lineViews(views), 'each promise was shown as it was made').toEqual(['Dev', 'promised · send Dev the deck tonight', 'promised · introduce Dev to Sam', 'promised · book the room'])
    clock.advance(LINE_MS)
    session.tap()
    session.swipeDown()
    expect(views.at(-1)!.view, 'the promises page, in the order made').toEqual({ kind: 'promises', you: ['send Dev the deck tonight', 'introduce Dev to Sam', 'book the room'] })
  })
})

// Fix round, risk-2 and operator answer 9: a promise pass has D89's three
// seconds on the session's clock. One that has not answered by then shows no
// line, and the end of the conversation waits for it no longer; if it answers
// later while the conversation is open, its promise is held without a line
// (the promises page, the notification and the phone page still get it).
// Once the end has handed the promises on, a pass still out is cancelled.
describe('a promise pass past its three seconds (risk-2, answer 9)', () => {
  /** A model that answers only when the test says, and whose call the session can cancel. */
  function slowModel() {
    const calls: { said: string; signal: AbortSignal | undefined; answer: (summary: string | undefined) => void }[] = []
    const model: ModelClient = {
      complete(_m, prompt, call) {
        const said = /^The wearer now says: (.*)$/m.exec(prompt)![1]!
        return new Promise((resolve, reject) => {
          call?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          calls.push({ said, signal: call?.signal, answer: (summary) => resolve(JSON.stringify(summary === undefined ? { promise: false } : { promise: true, summary })) })
        })
      },
    }
    return { model, calls }
  }

  it('ends the conversation at the pass\'s deadline when the model never answers, and cancels the call', async () => {
    const { model, calls } = slowModel()
    const errors: unknown[] = []
    const { session, ended, say, settle, clock } = setup(model, { onModelError: (e) => errors.push(e) }, 1e-9)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck tonight.", 2, WEARER)
    expect(calls).toHaveLength(1)
    session.longPress()
    await settle()
    expect(ended, 'the end waits while the pass is inside its three seconds').toEqual([])
    clock.advance(PROMISE_MS - 1)
    await settle()
    expect(ended).toEqual([])
    clock.advance(1)
    await settle()
    expect(ended.map((e) => [e.names, e.promises]), 'the end, at the deadline, without the unanswered promise').toEqual([[['Dev'], []]])
    expect(calls[0]!.signal?.aborted, 'the call is cancelled once its answer can go nowhere').toBe(true)
    expect(errors, 'the lost promise is reported').toHaveLength(1)
    expect(String((errors[0] as Error).message)).not.toMatch(/deck|Dev/)
  })

  it('shows no line for a promise answered after three seconds, but holds it for the promises page and the end (answer 9)', async () => {
    const { model, calls } = slowModel()
    const late: unknown[] = []
    const { session, views, ended, say, settle, clock } = setup(model, { onLatePass: () => late.push(true) })
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck tonight.", 2, WEARER)
    clock.advance(PROMISE_MS + 500)
    await settle()
    expect(late, 'the lateness is reported').toHaveLength(1)
    calls[0]!.answer('send Dev the deck tonight')
    await settle()
    expect(lineViews(views), 'no promise line past three seconds').toEqual(['Dev'])
    session.tap()
    session.swipeDown()
    expect(views.at(-1)!.view, 'held for the promises page').toEqual({ kind: 'promises', you: ['send Dev the deck tonight'] })
    session.longPress()
    await settle()
    expect(ended.map((e) => e.promises), 'and for the end').toEqual([['send Dev the deck tonight']])
  })
})

// Fix round, risk-3: the end's hook runs later when a pass was in flight; a
// throw there reaches the session's error path, never an unhandled rejection,
// and nothing runs once the session has closed.
describe("the deferred end's hook (risk-3)", () => {
  it('sends a throw from a deferred onEnd to onEndError, not to an unhandled rejection', async () => {
    const { model, release } = fakeModel({ "I'll send you the deck.": 'send Dev the deck' }, true)
    const failures: unknown[] = []
    const { session, say, settle } = setup(model, {
      onEnd: () => {
        throw new Error('the store is closed')
      },
      onEndError: (e) => failures.push(e),
    })
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck.", 2, WEARER)
    session.longPress()
    release()
    await settle()
    await settle()
    expect(failures.map((e) => (e as Error).message)).toEqual(['the store is closed'])
  })

  it('never runs a deferred end once the session has closed', async () => {
    const { model, release } = fakeModel({ "I'll send you the deck.": 'send Dev the deck' }, true)
    const { session, ended, say, settle } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck.", 2, WEARER)
    session.longPress()
    session.close()
    release()
    await settle()
    await settle()
    expect(ended).toEqual([])
  })
})
