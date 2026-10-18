import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { ModelClient } from '../llm/client.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { writeJogger } from './jogger.ts'
import { PromiseDetector } from './promises.ts'
import { KEEP_PROMPT, LINE_MS, LISTENING, PAUSED, QUIET_MS, Session, type EndedConversation, type SessionState } from './session.ts'
import type { TranscriptWord } from './transcript.ts'

// Pause in the session on its own (P6, D86, D81), behind the operator's
// switch (CATCH_PAUSE). The second reviewer's focus: a swipe down has three
// meanings, the names page's (the promises page, D43), the keep prompt's (no,
// D40) and the bare dot's (pause, only with the switch on), and none on a
// catch line or the promises page; with the switch off the dot's is nothing.
// While paused nothing is heard, held or transcribed, nothing comes on the
// lens, and the conversation's quiet is frozen (D81), across a restart too
// (P9). The clock is near-frozen: only advance() moves it, so every bound is exact.

const WEARER = -12
const OTHER = -28

const DOT: LensView = { kind: 'dot' }
const DASH: LensView = { kind: 'dash' }
const line = (text: string): LensView => ({ kind: 'line', text })

function setup(opts: { pause?: boolean; model?: ModelClient; saved?: SessionState; clock?: VirtualClock } = {}) {
  const clock = opts.clock ?? new VirtualClock(1e-6)
  const views: LensView[] = []
  const ended: EndedConversation[] = []
  const stored: TranscriptWord[] = []
  const saves: SessionState[] = []
  const paused: boolean[] = []
  let pause = opts.pause ?? true
  const session = new Session({
    clock,
    split: loudnessSplit(),
    onEnd: (e) => ended.push(e),
    pause: () => pause,
    persist: (s) => saves.push(s),
    ...(opts.saved ? { saved: opts.saved } : {}),
    ...(opts.model ? { promises: new PromiseDetector(opts.model) } : {}),
    transcript: { add: (w) => stored.push(w), words: () => stored.slice(), delete: () => void stored.splice(0) },
  })
  const attach = () => session.attach((view) => views.push(view), { onPaused: (p) => paused.push(p) })
  const attachment = attach()
  session.setHearing(true)
  let seq = 0
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  /** The words of `text` said from second `start`, 0.3 s each. */
  const wordsOf = (text: string, start: number) => text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
  /** The frames of `text` said from second `start`, and the clock to its end, but not yet its words (the provider has still to answer). */
  const hear = (text: string, start: number, dbfs: number) => {
    const words = wordsOf(text, start)
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) {
      session.frame({ seq: seq++, captureMs: (t / 10) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    clock.advance(Math.max(0, words.at(-1)!.end * 1000 - clock.now()))
    return words
  }
  /** `text` said from second `start`: its frames, the clock to its end, then its words. */
  const say = (text: string, start: number, dbfs: number) => session.words(hear(text, start, dbfs))
  const shows = () => session.current()
  return { clock, session, views, ended, stored, saves, paused, say, hear, word, shows, attach, attachment, setSwitch: (on: boolean) => (pause = on) }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("a swipe down's meanings (D43, D40, D86), with the pause switched off (the demo build)", () => {
  it('means nothing at the bare dot: no `paused`, no dash, the lens never told to stop', () => {
    const { session, say, shows, views, paused } = setup({ pause: false })
    say('Morning, everyone.', 0, WEARER)
    const before = views.length
    session.swipeDown()
    expect(shows()).toEqual(DOT)
    expect(views.slice(before), 'nothing new on the lens').toEqual([])
    expect(paused, 'the lens never told to stop listening').toEqual([])
    expect(session.isPaused).toBe(false)
  })

  it('still turns the names page to the promises page, and still declines the keep prompt', () => {
    const { clock, session, say, shows } = setup({ pause: false })
    say('Morning, everyone.', 0, WEARER)
    session.tap()
    expect(shows().kind).toBe('names')
    session.swipeDown()
    expect(shows()).toEqual({ kind: 'promises', you: [], owed: [] })
    clock.advance(5000)
    expect(shows()).toEqual(DOT)
    session.swipeUp()
    expect(shows()).toEqual(line(KEEP_PROMPT))
    session.swipeDown()
    expect(shows(), 'declined').toEqual(DOT)
    session.swipeUp()
    expect(shows(), 'a later swipe up asks again: nothing was kept').toEqual(line(KEEP_PROMPT))
  })

  it('keeps hearing and transcribing after it', () => {
    const { session, say, stored } = setup({ pause: false })
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    say('Still here.', 2, WEARER)
    expect(stored.map((w) => w.text)).toEqual(['Morning,', 'everyone.', 'Still', 'here.'])
  })
})

describe("a swipe down's meanings (D43, D40, D86), with the pause switched on", () => {
  it('pauses at the bare dot: `paused` for exactly a second and a half, then the dash, and the lens told to stop', () => {
    const { clock, session, say, shows, paused } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    expect(shows()).toEqual(line(PAUSED))
    expect(paused).toEqual([true])
    clock.advance(LINE_MS - 1)
    expect(shows()).toEqual(line(PAUSED))
    clock.advance(1)
    expect(shows(), 'then the dash').toEqual(DASH)
    clock.advance(30 * 60_000)
    expect(shows(), 'for as long as the pause lasts').toEqual(DASH)
  })

  it('resumes at the dash: `listening` for exactly a second and a half, then the dot, and the lens told to listen', () => {
    const { clock, session, say, shows, paused } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    clock.advance(LINE_MS)
    session.swipeDown()
    expect(shows()).toEqual(line(LISTENING))
    expect(paused).toEqual([true, false])
    clock.advance(LINE_MS - 1)
    expect(shows()).toEqual(line(LISTENING))
    clock.advance(1)
    expect(shows()).toEqual(DOT)
    expect(session.isPaused).toBe(false)
  })

  it('resumes on a swipe down while `paused` is still showing, too', () => {
    const { session, say, shows } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    session.swipeDown()
    expect(shows()).toEqual(line(LISTENING))
  })

  it('still turns the names page to the promises page, and still declines the keep prompt: neither pauses', () => {
    const { clock, session, say, shows, paused } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.tap()
    session.swipeDown()
    expect(shows()).toEqual({ kind: 'promises', you: [], owed: [] })
    session.swipeDown()
    expect(shows(), 'a swipe down on the promises page means nothing').toEqual({ kind: 'promises', you: [], owed: [] })
    clock.advance(5000)
    session.swipeUp()
    session.swipeDown()
    expect(shows(), 'the prompt declined').toEqual(DOT)
    expect(paused, 'never paused').toEqual([])
    expect(session.isPaused).toBe(false)
  })

  it('does not pause during a catch line, nor while Catch cannot hear', () => {
    const { clock, session, say, shows, paused } = setup()
    say('Morning, everyone.', 0, WEARER)
    say("Hi, I'm Priya.", 2, OTHER)
    expect(shows()).toEqual(line('Priya'))
    session.swipeDown()
    expect(shows(), 'the line stays').toEqual(line('Priya'))
    clock.advance(LINE_MS)
    expect(shows()).toEqual(DOT)
    session.setHearing(false)
    session.swipeDown()
    expect(shows(), "can't-hear stays can't-hear").toEqual({ kind: 'deaf' })
    expect(paused).toEqual([])
  })

  it('reads the switch at every swipe', () => {
    const { session, say, shows, setSwitch } = setup({ pause: false })
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    expect(shows()).toEqual(DOT)
    setSwitch(true)
    session.swipeDown()
    expect(shows()).toEqual(line(PAUSED))
  })
})

describe('while paused (D86): nothing heard, held, transcribed or shown', () => {
  it('takes no frame and no word: no name caught, no transcript, nothing on the lens', () => {
    const { clock, session, say, shows, stored, views } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    clock.advance(LINE_MS)
    const before = views.length
    say("Hi, I'm Priya.", 3, OTHER)
    say("I'll send you the deck.", 6, WEARER)
    session.utteranceEnd(8)
    expect(stored.map((w) => w.text), 'the transcript').toEqual(['Morning,', 'everyone.'])
    expect(views.slice(before), 'nothing on the lens').toEqual([])
    expect(shows()).toEqual(DASH)
    session.swipeDown()
    clock.advance(LINE_MS)
    session.tap()
    expect(shows(), 'no name held').toEqual({ kind: 'names', names: [] })
  })

  it('a tap and a swipe up do nothing; a long-press still ends the conversation, and Catch stays paused', () => {
    const { clock, session, say, shows, ended } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    clock.advance(LINE_MS)
    session.tap()
    expect(shows()).toEqual(DASH)
    session.swipeUp()
    expect(shows()).toEqual(DASH)
    session.longPress()
    expect(ended, 'D52: the long-press ends it').toHaveLength(1)
    expect(shows()).toEqual(DASH)
    expect(session.isPaused).toBe(true)
  })

  it('shows the dash, never the empty lens of can\'t-hear, when the lens drops and comes back, and tells the new lens it is paused', () => {
    const { clock, session, say, shows, attachment, attach, paused, ended } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    clock.advance(LINE_MS)
    attachment.detach()
    expect(shows()).toEqual(DASH)
    attach()
    expect(shows()).toEqual(DASH)
    expect(paused, 'told twice: at the swipe, and as the new lens joined').toEqual([true, true])
    session.swipeDown()
    expect(shows(), 'the second swipe resumes').toEqual(line(LISTENING))
    session.setHearing(true)
    session.longPress()
    // The pause is one span not heard (D53, the operator's answer 1), from the swipe to the resume: the lens dropping inside it starts no second one.
    expect(ended[0]!.gaps.map((g) => ({ at: g.at, ms: Math.round(g.ms) })), 'the pause, one span not heard').toEqual([{ at: 0.6, ms: LINE_MS }])
  })

  it("still judges and transcribes the words said before the swipe that the provider answers after it, and never one past it (risk-1, the operator's answer 4)", async () => {
    const model: ModelClient = { complete: async () => JSON.stringify({ promise: true, summary: 'send the deck' }) }
    const { clock, session, say, hear, word, stored, views, shows } = setup({ model })
    say('Morning, everyone.', 0, WEARER)
    // Heard, but the provider has not answered yet when the wearer swipes.
    const priya = hear("Hi, I'm Priya.", 2, OTHER)
    const deck = hear("I'll send you the deck.", 3.5, WEARER)
    session.swipeDown()
    clock.advance(LINE_MS)
    const before = views.length
    session.words(priya)
    session.words(deck)
    // Timed past the last audio heard before the swipe: said after it began.
    session.words([word('Secret.', 5.1, 5.4)])
    session.utteranceEnd(5.4)
    await settle()
    await settle()
    expect(stored.map((w) => w.text), 'the transcript').toEqual(['Morning,', 'everyone.', 'Hi,', "I'm", 'Priya.', "I'll", 'send', 'you', 'the', 'deck.'])
    expect(views.slice(before), 'nothing on the lens while paused').toEqual([])
    expect(shows()).toEqual(DASH)
    session.swipeDown()
    clock.advance(LINE_MS)
    session.tap()
    expect(shows(), 'the name said before the swipe is held').toEqual({ kind: 'names', names: ['Priya'] })
    session.swipeDown()
    expect(shows(), 'and the promise, judged').toEqual({ kind: 'promises', you: ['send the deck'], owed: [] })
  })

  it("keeps the quiet frozen when the wearer's own words from before the swipe arrive during the pause (D81)", () => {
    const { clock, session, say, hear, ended } = setup()
    say('Morning, everyone.', 0, WEARER)
    const late = hear('Okay, one sec.', 1, WEARER)
    session.swipeDown()
    session.words(late)
    clock.advance(2 * QUIET_MS)
    expect(ended, 'not ended while paused').toEqual([])
    session.swipeDown()
    const resumed = clock.now()
    // The wearer's last word ended as the swipe came: all ten minutes were left.
    clock.advance(QUIET_MS - 1)
    expect(ended).toEqual([])
    clock.advance(1)
    expect(ended).toHaveLength(1)
    expect(Math.abs(ended[0]!.endedAt - resumed - QUIET_MS)).toBeLessThan(1)
  })

  it('holds a promise whose pass answers during the pause, without its line', async () => {
    let answer!: (s: string) => void
    const model: ModelClient = { complete: () => new Promise<string>((r) => (answer = r)) }
    const { clock, session, say, shows, views } = setup({ model })
    say("I'll send you the deck.", 0, WEARER)
    session.swipeDown()
    clock.advance(LINE_MS)
    const before = views.length
    answer(JSON.stringify({ promise: true, summary: 'send the deck' }))
    await settle()
    await settle()
    expect(views.slice(before), 'no line while paused').toEqual([])
    session.swipeDown()
    clock.advance(LINE_MS)
    session.tap()
    session.swipeDown()
    expect(shows(), 'held all the same').toEqual({ kind: 'promises', you: ['send the deck'], owed: [] })
  })
})

describe('a pause freezes the conversation (D81)', () => {
  it('stops the quiet with what was left, and runs it on from there at the resume', () => {
    const { clock, session, say, ended, shows } = setup()
    say('Morning, everyone.', 0, WEARER)
    const spoke = clock.now()
    clock.advance(4 * 60_000)
    session.swipeDown()
    clock.advance(12 * 60_000)
    expect(ended, 'not ended in twelve minutes paused').toEqual([])
    expect(session.conversationOpen).toBe(true)
    session.swipeDown()
    const resumed = clock.now()
    clock.advance(QUIET_MS - 4 * 60_000 - 1)
    expect(ended, 'still open a moment before the six minutes left').toEqual([])
    clock.advance(1)
    expect(ended, 'ended at the six minutes').toHaveLength(1)
    expect(Math.abs(ended[0]!.endedAt - resumed - 6 * 60_000)).toBeLessThan(1)
    expect(Math.abs(resumed - spoke - 16 * 60_000)).toBeLessThan(1)
    expect(shows()).toEqual(DOT)
  })

  it("records the pause as a span not heard, so a kept jogger says how long was missed (D53, the fence; the operator's answer 1)", async () => {
    const { clock, session, say, ended, shows } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeUp()
    session.tap()
    clock.advance(60_000)
    expect(shows()).toEqual(DOT)
    session.swipeDown()
    clock.advance(12 * 60_000)
    session.swipeDown()
    clock.advance(60_000)
    session.longPress()
    expect(ended).toHaveLength(1)
    expect(ended[0]!.kept).toBe(true)
    // Where the pause fell (the end of the audio heard before it), and how long it lasted.
    expect(ended[0]!.gaps.map((g) => ({ at: g.at, minutes: Math.round(g.ms / 60_000) }))).toEqual([{ at: 0.6, minutes: 12 }])
    const model: ModelClient = { complete: async () => JSON.stringify({ bullets: [{ line: 1, text: 'Said good morning' }] }) }
    const draft = await writeJogger(model, { names: [], transcript: ended[0]!.transcript, promises: [], promiseTimes: [], gaps: ended[0]!.gaps })
    expect(draft.bullets).toEqual(['Said good morning', '12 minutes not heard'])
  })

  it('records the span not heard when a long-press ends the conversation during the pause, too (D53, D52)', () => {
    const { clock, session, say, ended, shows } = setup()
    say('Morning, everyone.', 0, WEARER)
    session.swipeDown()
    clock.advance(12 * 60_000)
    session.longPress()
    expect(ended.map((e) => e.gaps.map((g) => ({ at: g.at, minutes: Math.round(g.ms / 60_000) })))).toEqual([[{ at: 0.6, minutes: 12 }]])
    expect(shows(), 'Catch stays paused').toEqual(DASH)
  })

  it('holds across a restart (P9): the pause and what was left of the quiet are saved, and taken up', () => {
    const first = setup()
    first.say('Morning, everyone.', 0, WEARER)
    first.say("Hi, I'm Priya.", 2, OTHER)
    first.clock.advance(4 * 60_000)
    first.session.swipeDown()
    first.session.close()
    const saved = first.saves.at(-1)!
    expect(saved.paused, 'the pause is saved').toBe(true)
    // The wearer last spoke at 0.6 s; Priya's line took the clock to 2.9 s; four minutes on, the swipe.
    expect(Math.abs(saved.conversation!.quietLeft! - (QUIET_MS - (2.9 + 240 - 0.6) * 1000)), 'and what was left of the quiet').toBeLessThan(1)
    // The next process starts twelve minutes later.
    const clock = first.clock
    clock.advance(12 * 60_000)
    const second = setup({ saved, clock })
    expect(second.session.isPaused).toBe(true)
    expect(second.session.conversationOpen, 'the conversation is not ended by the time that passed').toBe(true)
    expect(second.shows()).toEqual(DASH)
    expect(second.paused, 'the lens is told it is paused as it joins').toEqual([true])
    clock.advance(QUIET_MS)
    expect(second.ended, 'frozen while paused').toEqual([])
    second.session.swipeDown()
    clock.advance(saved.conversation!.quietLeft! - 1)
    expect(second.ended).toEqual([])
    clock.advance(1)
    expect(second.ended.map((e) => e.names)).toEqual([['Priya']])
    // One span not heard, the pause with the restart inside it (D53, the operator's answer 1): from the swipe, where the audio heard ended, to the resume.
    expect(second.ended[0]!.gaps.map((g) => ({ at: g.at, minutes: Math.round(g.ms / 60_000) })), 'the pause, one span not heard').toEqual([{ at: 2.9, minutes: 22 }])
  })

  it('with the switch turned off before the restart, listens again and runs the quiet on from where it froze', () => {
    const first = setup()
    first.say('Morning, everyone.', 0, WEARER)
    first.clock.advance(4 * 60_000)
    first.session.swipeDown()
    first.session.close()
    const saved = first.saves.at(-1)!
    const clock = first.clock
    clock.advance(12 * 60_000)
    const second = setup({ saved, clock, pause: false })
    expect(second.session.isPaused).toBe(false)
    expect(second.shows()).toEqual(DOT)
    clock.advance(saved.conversation!.quietLeft! - 1)
    expect(second.ended).toEqual([])
    clock.advance(1)
    expect(second.ended).toHaveLength(1)
  })
})
