import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { ModelClient } from '../llm/client.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { PromiseDetector } from './promises.ts'
import { ALREADY_KEPT, KEEP_PROMPT, KEPT, LINE_MS, PAGE_MS, Session, type EndedConversation, type SessionState } from './session.ts'
import type { TranscriptWord } from './transcript.ts'

// A restart (P9, D73) in the session on its own: what one session hands the
// store (`persist`) is all a session built from it (`saved`) has to go on, so
// whatever these tests read after the restart came through the saved state,
// never through the first session's memory. The transcript lives in a stand-in
// for the store that both sessions share, as the real one does.

const WEARER = -12
const OTHER = -28

/** Answers the wearer's prompt and the owed prompt from fixed summaries, by sentence, at once. */
function fakeModel(you: Record<string, string>, owed: Record<string, string>): ModelClient {
  return {
    complete(_m, prompt) {
      const wearer = /^The wearer now says: (.*)$/m.exec(prompt)?.[1]
      const said = wearer ?? /^The other person now says: (.*)$/m.exec(prompt)![1]!
      const summary = wearer !== undefined ? you[said] : owed[said]
      return Promise.resolve(JSON.stringify(summary === undefined ? { promise: false } : { promise: true, summary }))
    },
  }
}

const MODEL = fakeModel({ "I'll send you the deck.": 'send Dev the deck' }, { "I'll send you the agenda.": 'send the agenda' })

/** The store as both processes see it: the saved states, the transcript, and every conversation that ended. */
function store() {
  return { states: [] as SessionState[], transcript: [] as TranscriptWord[], ended: [] as EndedConversation[], saves: 0 }
}

/** One process's session on `db`, built from `saved` when given; its views, and a way to speak into it. */
function proc(clock: VirtualClock, db: ReturnType<typeof store>, saved?: SessionState, lens = 'launch-1') {
  const views: LensView[] = []
  const session = new Session({
    clock,
    split: loudnessSplit(),
    promises: new PromiseDetector(MODEL),
    onEnd: (e) => db.ended.push(e),
    persist: (s) => {
      db.saves++
      db.states.push(structuredClone(s))
    },
    ...(saved ? { saved } : {}),
    transcript: {
      add: (w) => db.transcript.push(w),
      words: () => [...db.transcript],
      delete: () => {
        db.transcript.length = 0
      },
    },
  })
  session.attach((v) => views.push(v), { lens })
  session.setHearing(true)
  let seq = 0
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  /** `text` said from the clock's reading now (in seconds on the lens's capture clock), its frames then its words. */
  const say = (text: string, dbfs: number) => {
    // The lens's capture clock is the session clock here, and the first frame starts at 0, so the timeline is the capture clock in seconds.
    const start = Math.ceil(Math.round(clock.now()) / 100) / 10
    const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) {
      session.frame({ seq: seq++, captureMs: (t / 10) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    clock.advance(Math.max(0, words.at(-1)!.end * 1000 - clock.now()))
    return words
  }
  /** Words on the session's timeline: the session places them from where the lens frames put them. */
  const speak = (text: string, dbfs: number) => {
    const words = say(text, dbfs)
    session.words(words)
  }
  return { session, views, speak, now: () => session.current() }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
const fade = (clock: VirtualClock) => clock.advance(LINE_MS + 10)

/** The first process: Priya and Dev, a promise each way, the keep, then Ana; left open. */
async function firstProcess(clock: VirtualClock, db: ReturnType<typeof store>) {
  const p = proc(clock, db)
  p.speak('Hello there.', WEARER)
  p.speak("Hi, I'm Priya.", OTHER)
  fade(clock)
  p.speak("Hi, I'm Dev.", OTHER)
  fade(clock)
  p.speak("I'll send you the deck.", WEARER)
  await settle()
  fade(clock)
  p.speak("I'll send you the agenda.", OTHER)
  await settle()
  fade(clock)
  p.session.swipeUp()
  expect(p.now()).toEqual({ kind: 'line', text: KEEP_PROMPT })
  p.session.tap()
  expect(p.now()).toEqual({ kind: 'line', text: KEPT })
  fade(clock)
  p.speak("Hi, I'm Ana.", OTHER)
  fade(clock)
  return p
}

describe('a restart mid-conversation (P9, D73)', () => {
  it('takes up the same conversation from the saved state: names in order, both kinds of promise, the keep mark, the transcript, a minute not heard', async () => {
    // Near-frozen: only advance() moves the clock, so the minute is a minute to the millisecond.
    const clock = new VirtualClock(1e-6)
    const db = store()
    const first = await firstProcess(clock, db)
    const heardBefore = db.transcript.map((w) => w.text)
    first.session.close()
    const savedAtClose = db.states.at(-1)!
    expect(savedAtClose.conversation, 'the store holds the open conversation').toBeDefined()
    const savesAtClose = db.saves

    // A minute with no server; then a fresh launch of the plugin finds the restarted one.
    clock.advance(60_000)
    const second = proc(clock, db, structuredClone(savedAtClose), 'launch-2')
    expect(second.session.conversationOpen, 'the conversation is open again, not ended and not a new one').toBe(true)
    expect(db.ended, 'nothing ended at the restart').toEqual([])

    second.session.tap()
    expect(second.now()).toEqual({ kind: 'names', names: ['Priya', 'Dev', 'Ana'] })
    second.session.swipeDown()
    expect(second.now()).toEqual({ kind: 'promises', you: ['send Dev the deck'], owed: ['Dev sends the agenda'] })
    clock.advance(PAGE_MS + 10)
    second.session.swipeUp()
    expect(second.now(), 'the keep mark came through').toEqual({ kind: 'line', text: ALREADY_KEPT })
    fade(clock)

    // The conversation goes on, and ends once.
    second.speak('Sorry, I lost you there.', WEARER)
    second.session.longPress()
    await settle()
    expect(db.ended).toHaveLength(1)
    const ended = db.ended[0]!
    expect(ended.names).toEqual(['Priya', 'Dev', 'Ana'])
    expect(ended.promises).toEqual(['send Dev the deck'])
    expect(ended.owed).toEqual(['Dev sends the agenda'])
    expect(ended.kept).toBe(true)
    // The transcript covers both processes, in order, on one timeline.
    expect(ended.transcript.map((w) => w.text)).toEqual([...heardBefore, 'Sorry,', 'I', 'lost', 'you', 'there.'])
    for (let i = 1; i < ended.transcript.length; i++) expect(ended.transcript[i]!.start).toBeGreaterThan(ended.transcript[i - 1]!.start)
    // One span not heard, from the close to the second process hearing, where the restart fell.
    expect(ended.gaps).toHaveLength(1)
    expect(ended.gaps[0]!.at).toBe(savedAtClose.coveredUntil)
    expect(ended.gaps[0]!.ms).toBeCloseTo(60_000, 0)
    expect(ended.transcript.filter((w) => w.end <= ended.gaps[0]!.at + 1e-6).map((w) => w.text)).toEqual(heardBefore)
    // Its words are deleted at its end like any other's (D76), and the store no longer holds a conversation.
    expect(db.transcript).toEqual([])
    expect(db.states.at(-1)!.conversation).toBeUndefined()
    // The first process saved nothing after it closed.
    expect(db.states.slice(savesAtClose).every((s) => s.lens === 'launch-2')).toBe(true)
  })

  it('a repeated name keeps its two-minute window across the restart (D87)', () => {
    const clock = new VirtualClock(1e-6)
    const db = store()
    const first = proc(clock, db)
    first.speak('Hello there.', WEARER)
    first.speak("Hi, I'm Priya.", OTHER)
    fade(clock)
    first.session.close()
    clock.advance(30_000)
    const second = proc(clock, db, db.states.at(-1)!, 'launch-2')
    second.speak("Hi, I'm Priya.", OTHER)
    expect(second.views).toContainEqual({ kind: 'line', text: 'Priya (2)' })
  })

  it('a crash saves nothing at the end: the span not heard runs from the last save', () => {
    const clock = new VirtualClock(1e-6)
    const db = store()
    const first = proc(clock, db)
    first.speak('Hello there.', WEARER)
    // The process dies here: no close, no detach. Its last save is what the store holds.
    const last = structuredClone(db.states.at(-1)!)
    expect(last.conversation!.deafSince).toBeUndefined()
    clock.advance(45_000)
    const heardAgain = clock.now()
    const second = proc(clock, db, last, 'launch-2')
    second.session.longPress()
    expect(db.ended[0]!.gaps).toHaveLength(1)
    expect(db.ended[0]!.gaps[0]!.at).toBe(last.coveredUntil)
    expect(db.ended[0]!.gaps[0]!.ms).toBeCloseTo(heardAgain - last.savedAt, 0)
    expect(db.ended[0]!.gaps[0]!.ms).toBeGreaterThanOrEqual(45_000 - 1)
  })
})

describe('the quiet rule across a restart (P9, D92, D76)', () => {
  it('ends a conversation whose ten minutes ran out while no server ran, as the session is built, at the moment they ran out, and deletes its words', () => {
    const clock = new VirtualClock(1e-6)
    const db = store()
    const first = proc(clock, db)
    first.speak('Hello there.', WEARER)
    first.speak("Hi, I'm Priya.", OTHER)
    fade(clock)
    first.session.swipeUp()
    first.session.tap()
    const quietUntil = db.states.at(-1)!.conversation!.quietUntil
    const closedAt = clock.now()
    first.session.close()
    expect(db.transcript.length).toBeGreaterThan(0)
    // Down for eleven minutes: nobody ever comes back to it.
    clock.advance(11 * 60_000)
    const second = proc(clock, db, db.states.at(-1)!, 'launch-2')
    expect(second.session.conversationOpen).toBe(false)
    expect(db.ended).toHaveLength(1)
    expect(db.ended[0]!.endedAt, 'it ended when its quiet ran out, not at the restart').toBe(quietUntil)
    expect(db.ended[0]!.kept).toBe(true)
    expect(db.ended[0]!.names).toEqual(['Priya'])
    // The span not heard runs to its end, no further.
    expect(db.ended[0]!.gaps).toHaveLength(1)
    expect(db.ended[0]!.gaps[0]!.ms).toBeCloseTo(quietUntil - closedAt, 0)
    expect(db.transcript, 'its words are gone').toEqual([])
    expect(db.states.at(-1)!.conversation).toBeUndefined()
  })

  it('runs the same ten minutes on after a restart that came before they ran out', () => {
    const clock = new VirtualClock(1e-6)
    const db = store()
    const first = proc(clock, db)
    first.speak('Hello there.', WEARER)
    const quietUntil = db.states.at(-1)!.conversation!.quietUntil
    clock.advance(3 * 60_000)
    first.session.close()
    clock.advance(4 * 60_000)
    const second = proc(clock, db, db.states.at(-1)!, 'launch-2')
    expect(second.session.conversationOpen).toBe(true)
    clock.advance(quietUntil - clock.now() - 1)
    expect(second.session.conversationOpen, 'a millisecond before the ten minutes').toBe(true)
    clock.advance(1)
    expect(second.session.conversationOpen, 'at the ten minutes, not ten minutes after the restart').toBe(false)
    expect(db.transcript).toEqual([])
  })
})

describe('the first conversation per plugin launch across a restart (P9, D129)', () => {
  it('the same launch reconnecting after a restart is no new start; a fresh launch is', () => {
    const clock = new VirtualClock(1e-6)
    const db = store()
    const first = proc(clock, db, undefined, 'launch-1')
    first.speak("Hi, I'm Priya.", OTHER)
    expect(first.session.conversationOpen, 'anyone begins the first conversation of a launch').toBe(true)
    first.session.longPress()
    first.session.close()
    const saved = db.states.at(-1)!
    expect(saved.conversation).toBeUndefined()

    const same = proc(clock, db, structuredClone(saved), 'launch-1')
    same.speak("Hi, I'm Dana.", OTHER)
    expect(same.session.conversationOpen, 'the same launch: only the wearer begins the next').toBe(false)
    same.session.close()

    const fresh = proc(clock, db, structuredClone(saved), 'launch-2')
    fresh.speak("Hi, I'm Dana.", OTHER)
    expect(fresh.session.conversationOpen, 'a fresh launch: anyone begins it').toBe(true)
  })
})
