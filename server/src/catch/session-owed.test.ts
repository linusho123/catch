import { describe, expect, it } from 'vitest'
import type { LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { ModelClient } from '../llm/client.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { PromiseDetector } from './promises.ts'
import { FRAME_WAIT_MS, LINE_MS, PROMISE_MS, Session, type EndedConversation } from './session.ts'

// Promises owed to the wearer (P5, D91, D26, D113) in the session on its own:
// someone else's sentence with a commitment cue gets the owed pass; the
// promiser is the last name caught, or an unnamed promiser numbered in the
// order heard; a name caught later attaches to the most recent promiser if
// that one is unnamed. The model here answers by the sentence it is asked
// about, at once, or when the test lets it.

const WEARER = -12
const OTHER = -28

/** Answers the owed prompt from `owed` and the wearer's from `you`, by sentence; `hold` lists the owed calls and answers them only when told. */
function fakeModel(owed: Record<string, string>, you: Record<string, string> = {}, hold = false) {
  const calls: { said: string; answer: (action: string | undefined) => void }[] = []
  const model: ModelClient = {
    complete(_m, prompt) {
      const wearer = /^The wearer now says: (.*)$/m.exec(prompt)?.[1]
      const said = wearer ?? /^The other person now says: (.*)$/m.exec(prompt)![1]!
      const summary = wearer !== undefined ? you[said] : owed[said]
      const json = (s: string | undefined) => JSON.stringify(s === undefined ? { promise: false } : { promise: true, summary: s })
      if (!hold || wearer !== undefined) return Promise.resolve(json(summary))
      return new Promise((resolve) => calls.push({ said, answer: (s) => resolve(json(s)) }))
    },
  }
  return { model, calls }
}

function setup(model: ModelClient) {
  // Near-frozen: only advance() moves the clock (the line's second and a half is asserted to the millisecond).
  const clock = new VirtualClock(1e-6)
  const views: { at: number; view: LensView }[] = []
  const ended: EndedConversation[] = []
  const late: unknown[] = []
  const session = new Session({
    clock,
    split: loudnessSplit(),
    show: (view) => views.push({ at: clock.now(), view }),
    promises: new PromiseDetector(model),
    onEnd: (e) => ended.push(e),
    onLatePass: () => late.push(true),
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
  /** Any line come and gone (a last word waits for its frame first), then a tap and a swipe down: the promises page. */
  const promisesPage = () => {
    clock.advance(FRAME_WAIT_MS + LINE_MS + 1)
    session.tap()
    session.swipeDown()
    const page = views.at(-1)!.view
    session.tap()
    return page
  }
  return { clock, session, views, ended, late, say, settle, promisesPage }
}

const lines = (views: { view: LensView }[]) => views.flatMap(({ view }) => (view.kind === 'line' ? [view.text] : []))

describe('promises owed to the wearer, in the session (P5)', () => {
  it("names Dev's promise by the last name caught, shows `Dev promised · …`, and holds it after the wearer's own (D91)", async () => {
    const { model } = fakeModel({ "I'll send you the agenda.": 'send the agenda' }, { "I'll send you the deck tonight.": 'send Dev the deck tonight' })
    const { session, views, ended, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the deck tonight.", 3, WEARER)
    await settle()
    say("I'll send you the agenda.", 8, OTHER)
    await settle()
    expect(lines(views)).toEqual(['Dev', 'promised · send Dev the deck tonight', 'Dev promised · send the agenda'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: ['send Dev the deck tonight'], owed: ['Dev sends the agenda'] })
    session.longPress()
    await settle()
    expect(ended.map((e) => [e.promises, e.owed])).toEqual([[['send Dev the deck tonight'], ['Dev sends the agenda']]])
  })

  it('holds a promise from someone unnamed as `they (1)`, shown as `they promised · …` (D26, D113)', async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send the deck tonight' })
    const { session, views, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say("I'll send you the deck tonight.", 3, OTHER)
    await settle()
    expect(lines(views)).toEqual(['they promised · send the deck tonight'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) sends the deck tonight'] })
  })

  it('gives the unnamed promiser the name caught next (D26, D113)', async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send the deck tonight' })
    const { session, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say("I'll send you the deck tonight.", 3, OTHER)
    await settle()
    say("By the way, I'm Dev.", 8, OTHER)
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Dev sends the deck tonight'] })
  })

  it('numbers two unnamed promisers in the order heard, and a name attaches to the most recent only (D113)', async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send the deck tonight', "I'll send you the slides.": 'send the slides' })
    const { session, views, say, settle, promisesPage, clock } = setup(model)
    session.setHearing(true)
    say('Morning, everyone.', 0, WEARER)
    say("I'll send you the deck tonight.", 2, OTHER)
    await settle()
    clock.advance(LINE_MS)
    say('Thanks.', 6, WEARER)
    say("I'll send you the slides.", 8, OTHER)
    await settle()
    expect(lines(views)).toEqual(['they promised · send the deck tonight', 'they promised · send the slides'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) sends the deck tonight', 'they (2) sends the slides'] })
    say("By the way, I'm Dev.", 14, OTHER)
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) sends the deck tonight', 'Dev sends the slides'] })
    // A second name caught attaches to nobody: the most recent promiser has one.
    say("And I'm Sam.", 20, OTHER)
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) sends the deck tonight', 'Dev sends the slides'] })
  })

  it('names a promise said after a name was caught by that name, whatever is caught after it', async () => {
    const { model } = fakeModel({ "I'll send you the agenda.": 'send the agenda' })
    const { session, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the agenda.", 3, OTHER)
    await settle()
    say("Hi, I'm Priya.", 8, OTHER)
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Dev sends the agenda'] })
  })

  it('lets a name caught while a pass is out pass to the promiser before when that pass says no promise (D113)', async () => {
    const { model, calls } = fakeModel({}, {}, true)
    const { session, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, everyone.', 0, WEARER)
    say("I'll send you the deck tonight.", 2, OTHER)
    calls[0]!.answer('send the deck tonight')
    await settle()
    say("I'll think about it.", 6, OTHER)
    // Its pass is out when the name comes: the name goes to it, the most recent promiser ...
    say("By the way, I'm Dev.", 8, OTHER)
    // ... and, when it turns out no promise, to the promiser before it.
    calls[1]!.answer(undefined)
    await settle()
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Dev sends the deck tonight'] })
  })

  it('holds an owed promise answered after three seconds without a line (answer 9)', async () => {
    const { model, calls } = fakeModel({}, {}, true)
    const { session, views, ended, late, say, settle, clock, promisesPage } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the agenda.", 3, OTHER)
    clock.advance(PROMISE_MS + 1)
    await settle()
    expect(late).toHaveLength(1)
    calls[0]!.answer('send the agenda')
    await settle()
    expect(lines(views)).toEqual(['Dev'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Dev sends the agenda'] })
    session.longPress()
    await settle()
    expect(ended.map((e) => e.owed)).toEqual([['Dev sends the agenda']])
  })

  it("waits at the end for an owed pass still out, and hands the promise on (D28)", async () => {
    const { model, calls } = fakeModel({}, {}, true)
    const { session, ended, say, settle } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll send you the agenda.", 3, OTHER)
    session.longPress()
    await settle()
    expect(ended, 'the end waits for the pass').toEqual([])
    calls[0]!.answer('send the agenda')
    await settle()
    await settle()
    expect(ended.map((e) => e.owed)).toEqual([['Dev sends the agenda']])
  })

  it('opens the names page, not the nothing-held page, when no name is held but a promise is', async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send the deck tonight' })
    const { session, views, say, settle, clock } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    session.tap()
    expect(views.at(-1)!.view, 'nothing held yet: D31').toEqual({ kind: 'names', names: [] })
    session.tap()
    say("I'll send you the deck tonight.", 3, OTHER)
    await settle()
    clock.advance(LINE_MS)
    session.tap()
    expect(views.at(-1)!.view).toEqual({ kind: 'names', names: [], promisesHeld: true })
  })

  it('lets the owed line replace a names page that is showing (D32: the newest wins)', async () => {
    const { model } = fakeModel({ "I'll send you the deck.": 'send the deck' })
    const { session, views, say, settle, clock } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say('Good to meet you, Dev.', 1.5, WEARER)
    clock.advance(LINE_MS)
    session.tap()
    expect(views.at(-1)!.view).toEqual({ kind: 'names', names: ['Dev'] })
    say("I'll send you the deck.", 5, OTHER)
    await settle()
    expect(views.at(-1)!.view).toEqual({ kind: 'line', text: 'Dev promised · send the deck' })
    clock.advance(LINE_MS)
    expect(views.at(-1)!.view, 'the page does not come back').toEqual({ kind: 'dot' })
  })

  // risk-1, widened by the human's answer (1): only a self-introduction ("I'm
  // X", "my name is X") names a promiser. A name in someone else's "meet X",
  // "this is X" or "X, nice to meet you" never names one, neither the
  // promiser of its own sentence nor an earlier unnamed one.
  it('risk-1: a name caught in the promise\'s own sentence by "meet X" does not name its promiser', async () => {
    const { model } = fakeModel({ "I'll meet Priya on Friday.": 'meet Priya on Friday' })
    const { session, views, ended, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say("I'll meet Priya on Friday.", 3, OTHER)
    await settle()
    expect(lines(views)).toEqual(['Priya', 'they promised · meet Priya on Friday'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) meets Priya on Friday'] })
    session.longPress()
    await settle()
    expect(ended.map((e) => e.owed)).toEqual([['they (1) meets Priya on Friday']])
  })

  it('risk-1: a "meet X" in the promise\'s own sentence leaves it with the last name caught before the sentence', async () => {
    const { model } = fakeModel({ "I'll introduce you, meet Priya, she runs the lab.": 'introduce you to Priya' })
    const { session, views, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say("I'll introduce you, meet Priya, she runs the lab.", 3, OTHER)
    await settle()
    expect(lines(views)).toEqual(['Dev', 'Priya', 'Dev promised · introduce you to Priya'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Dev introduces you to Priya'] })
  })

  it('risk-1: "this is X" and "X, nice to meet you" in the same sentence do not name its promiser either', async () => {
    for (const [said, action, owed] of [
      ["I'll send you the notes, this is Priya by the way.", 'send the notes', 'they (1) sends the notes'],
      ["Sam, nice to meet you, I'll call you tomorrow.", 'call you tomorrow', 'they (1) calls you tomorrow'],
    ] as const) {
      const { model } = fakeModel({ [said]: action })
      const { session, say, settle, promisesPage } = setup(model)
      session.setHearing(true)
      say('Morning, everyone.', 0, WEARER)
      say(said, 2, OTHER)
      await settle()
      expect(promisesPage(), said).toEqual({ kind: 'promises', you: [], owed: [owed] })
    }
  })

  it('risk-1: a self-introduction in the same sentence still names its promiser', async () => {
    const { model } = fakeModel({ "Hi, I'm Dev, I'll send you the agenda.": 'send the agenda' })
    const { session, views, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say("Hi, I'm Dev, I'll send you the agenda.", 3, OTHER)
    await settle()
    expect(lines(views)).toEqual(['Dev', 'Dev promised · send the agenda'])
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Dev sends the agenda'] })
  })

  it('risk-1 (answer 1): a name from "meet X" said after an unnamed promise does not attach to that earlier promiser', async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send the deck tonight' })
    const { session, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say("I'll send you the deck tonight.", 3, OTHER)
    await settle()
    say('You should meet Priya.', 8, OTHER)
    say('This is Sam.', 11, OTHER)
    say('Sam, nice to meet you.', 13, OTHER)
    await settle()
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) sends the deck tonight'] })
  })

  it('risk-1 (answer 1): a "meet X" that ends the promise\'s own sentence does not attach to it either', async () => {
    const { model } = fakeModel({ "Tomorrow I'll introduce you, you should meet Priya.": 'introduce you to Priya' })
    const { session, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('Morning, how was the trip?', 0, WEARER)
    say("Tomorrow I'll introduce you, you should meet Priya.", 3, OTHER)
    await settle()
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) introduces you to Priya'] })
  })

  it('risk-1: a name from "meet X" caught before a later sentence still names that later promiser (D91)', async () => {
    const { model } = fakeModel({ "I'll send you the agenda.": 'send the agenda' })
    const { session, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say('You should meet Priya.', 0, OTHER)
    say("I'll send you the agenda.", 3, OTHER)
    await settle()
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['Priya sends the agenda'] })
  })

  it("forgets the last name caught at the conversation's end: the next conversation's first promise is unnamed", async () => {
    const { model } = fakeModel({ "I'll send you the deck tonight.": 'send the deck tonight' })
    const { session, ended, say, settle, promisesPage } = setup(model)
    session.setHearing(true)
    say("Hi, I'm Dev.", 0, OTHER)
    say('Nice to meet you.', 2, WEARER)
    session.longPress()
    await settle()
    say('Morning again.', 10, WEARER)
    say("I'll send you the deck tonight.", 12, OTHER)
    await settle()
    expect(promisesPage()).toEqual({ kind: 'promises', you: [], owed: ['they (1) sends the deck tonight'] })
    expect(ended.map((e) => e.owed), 'the first conversation owed nothing').toEqual([[]])
  })
})
