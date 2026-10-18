import { describe, expect, it } from 'vitest'
import { NAMES_PER_PAGE, NAMES_PER_PAGE_UNDER_THREAD, type LensView } from '../../../shared/lens-protocol.ts'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { FRAME_WAIT_MS, KEEP_PROMPT, LINE_MS, PAGE_MS, Session } from './session.ts'

// P10, D43: the names page past one page of names, in the session on its own.
// A swipe down scrolls to the next page of names, and only at the last name
// turns to the promises page; a swipe up scrolls back, the promises page to
// the last names, and at the first name does nothing (never the keep prompt).
// Every page has five seconds of its own. The clock is near-frozen: only
// advance() moves it, so the five-second bounds are exact.

const WEARER = -12
const OTHER = -28

const NAMES = [
  'Priya', 'Marcus', 'Dana', 'Ana', 'Ben', 'Chloe', 'Diego', 'Elena', 'Farid', 'Grace',
  'Hiro', 'Imani', 'Jonas', 'Kenji', 'Leila', 'Mateo', 'Nadia', 'Omar', 'Petra', 'Quinn',
  'Rosa', 'Soren', 'Tara', 'Umar', 'Vera', 'Wes', 'Xavier', 'Yara', 'Zoe', 'Aiden',
]

function setup(count: number, opts: { threadDetection?: () => boolean } = {}) {
  const clock = new VirtualClock(1e-6)
  const views: LensView[] = []
  const session = new Session({ clock, split: loudnessSplit(), show: (view) => views.push(view), ...opts })
  session.setHearing(true)
  let seq = 0
  let heardTo = 0
  const word = (text: string, start: number, end: number, isFinal = true): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal })
  // Times to the millisecond, so a word's end never lands a hair past the frames that carry it.
  const ms = (t: number) => Math.round(t * 1000) / 1000
  const wordsOf = (text: string, start: number, isFinal: boolean) =>
    text.split(' ').map((t, i) => word(t, ms(start + i * 0.3), ms(start + i * 0.3 + 0.3), isFinal))
  /** Frames at `dbfs` from `from` (or where the audio heard so far ends) up to stream second `to`. */
  const audio = (to: number, dbfs: number, from = heardTo) => {
    for (let t = Math.round(from * 10) + 1; t <= Math.round(to * 10); t++) {
      session.frame({ seq: seq++, captureMs: (t / 10) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    heardTo = Math.max(heardTo, to)
  }
  const say = (text: string, start: number, dbfs: number) => {
    const words = wordsOf(text, start, true)
    audio(words.at(-1)!.end, dbfs, start)
    clock.advance(Math.max(0, words.at(-1)!.end * 1000 - clock.now()))
    session.words(words)
  }
  /**
   * The provider's interim hypothesis of `text` from `start` (PT): its audio,
   * then the words, never the clock moved on. A name in it is caught
   * tentatively, its line shown at once.
   */
  const interim = (text: string, start: number, dbfs: number) => {
    const words = wordsOf(text, start, false)
    audio(words.at(-1)!.end, dbfs)
    session.words(words)
  }
  /** The provider's final words for `text` from `start`, which confirm or withdraw a tentative name; the clock stays where it is. */
  const final = (text: string, start: number, dbfs: number) => {
    const words = wordsOf(text, start, true)
    audio(words.at(-1)!.end, dbfs)
    session.words(words)
  }
  say('Morning, everyone.', 0, WEARER)
  NAMES.slice(0, count).forEach((name, i) => say(`I'm ${name}.`, 2 + i, OTHER))
  // The last name's line has come and gone: the dot.
  clock.advance(FRAME_WAIT_MS)
  clock.advance(LINE_MS + 100)
  expect(session.current()).toEqual({ kind: 'dot' })
  expect(session.names.list()).toEqual(NAMES.slice(0, count))
  const shows = () => session.current()
  const pageOf = (from: number, per = NAMES_PER_PAGE): LensView => ({ kind: 'names', names: NAMES.slice(from, Math.min(from + per, count)) })
  return { clock, session, views, say, interim, final, shows, pageOf }
}

describe('scrolling past a page of names (P10, D43)', () => {
  it('pages thirty names, a page per swipe down, and turns to the promises page only past the last name', () => {
    const { session, shows, pageOf } = setup(30)
    expect(NAMES_PER_PAGE).toBe(7)
    session.tap()
    expect(shows()).toEqual(pageOf(0))
    for (const from of [7, 14, 21, 28]) {
      session.swipeDown()
      expect(shows(), `the page from name ${from + 1}`).toEqual(pageOf(from))
    }
    session.swipeDown()
    expect(shows()).toEqual({ kind: 'promises', you: [], owed: [] })
    // On the promises page a swipe down means nothing.
    session.swipeDown()
    expect(shows().kind).toBe('promises')
  })

  it('scrolls back on a swipe up, the promises page to the last names, and at the first name does nothing, never the keep prompt', () => {
    const { session, views, shows, pageOf } = setup(30)
    session.tap()
    for (let i = 0; i < 5; i++) session.swipeDown()
    expect(shows().kind).toBe('promises')
    for (const from of [28, 21, 14, 7, 0]) {
      session.swipeUp()
      expect(shows(), `back to the page from name ${from + 1}`).toEqual(pageOf(from))
    }
    const sent = views.length
    session.swipeUp()
    session.swipeUp()
    expect(views.length, 'nothing more reached the lens').toBe(sent)
    expect(shows()).toEqual(pageOf(0))
    expect(views.some((v) => v.kind === 'line' && v.text === KEEP_PROMPT), 'the keep prompt').toBe(false)
    // And down again from the first page, as before.
    session.swipeDown()
    expect(shows()).toEqual(pageOf(7))
  })

  it('gives every page five seconds of its own', () => {
    const { clock, session, shows, pageOf } = setup(30)
    session.tap()
    clock.advance(PAGE_MS - 1)
    session.swipeDown()
    clock.advance(PAGE_MS - 1)
    expect(shows(), 'the second page, a moment short of its five seconds').toEqual(pageOf(7))
    clock.advance(1)
    expect(shows()).toEqual({ kind: 'dot' })
  })

  // The operator's answer 4: a swipe up at the first name changes nothing on
  // the lens, but it is a touch, so the page's five seconds start again (D43,
  // "5 seconds pass with no touch").
  it('restarts the first page\'s five seconds on a swipe up at the first name, with nothing new on the lens', () => {
    const { clock, session, views, shows, pageOf } = setup(30)
    session.tap()
    clock.advance(PAGE_MS - 1)
    const sent = views.length
    session.swipeUp()
    expect(views.length, 'nothing more reached the lens').toBe(sent)
    clock.advance(1)
    expect(shows(), 'the first page outlives its first five seconds').toEqual(pageOf(0))
    clock.advance(PAGE_MS - 2)
    expect(shows(), 'a moment short of five seconds from the swipe').toEqual(pageOf(0))
    clock.advance(1)
    expect(shows(), 'five seconds from the swipe').toEqual({ kind: 'dot' })
    // Scrolled back to the first name, the same.
    session.tap()
    session.swipeDown()
    session.swipeUp()
    clock.advance(PAGE_MS - 1)
    session.swipeUp()
    clock.advance(PAGE_MS - 1)
    expect(shows()).toEqual(pageOf(0))
    clock.advance(1)
    expect(shows()).toEqual({ kind: 'dot' })
  })

  it('keeps one page for as many names as fit, and turns to the promises page from it; one more takes a second page', () => {
    const seven = setup(NAMES_PER_PAGE)
    seven.session.tap()
    expect(seven.shows()).toEqual(seven.pageOf(0))
    seven.session.swipeDown()
    expect(seven.shows().kind).toBe('promises')
    const eight = setup(NAMES_PER_PAGE + 1)
    eight.session.tap()
    eight.session.swipeDown()
    expect(eight.shows()).toEqual(eight.pageOf(NAMES_PER_PAGE))
    expect(eight.shows()).toEqual({ kind: 'names', names: [NAMES[NAMES_PER_PAGE]] })
    eight.session.swipeDown()
    expect(eight.shows().kind).toBe('promises')
  })

  it('lists a line fewer under the thread with detection off, the thread heading every page (D120)', () => {
    const { session, shows, say } = setup(10, { threadDetection: () => false })
    // The wearer is cut off mid-sentence and someone else takes the floor: the thread to give back.
    say('So the first reason is', 20, WEARER)
    say('Sorry to cut in here.', 22, OTHER)
    session.tap()
    const first = shows()
    expect(first.kind).toBe('names')
    if (first.kind !== 'names') return
    expect(first.thread, 'the thread heads the page').toBeDefined()
    expect(first.names).toEqual(NAMES.slice(0, NAMES_PER_PAGE_UNDER_THREAD))
    session.swipeDown()
    expect(shows()).toEqual({ kind: 'names', names: NAMES.slice(NAMES_PER_PAGE_UNDER_THREAD, 10), thread: first.thread })
    session.swipeDown()
    expect(shows().kind).toBe('promises')
    session.swipeUp()
    expect(shows(), 'back from the promises page, the thread still on top').toEqual({ kind: 'names', names: NAMES.slice(NAMES_PER_PAGE_UNDER_THREAD, 10), thread: first.thread })
  })
})

// head-1: the names change under a page that is showing (PT: a name caught
// from an interim is confirmed or withdrawn by the final words). The page in
// view stays where the wearer scrolled it; one left with no name on it gives
// way to the page before, never an empty names box.
describe('the names change under a scrolled page (P10, head-1)', () => {
  /** `count` names in finals, then one more caught from an interim after the circle, its line come and gone. */
  function withTentative(count: number) {
    const s = setup(count)
    // After the last name (said from second 2 + count - 1, 0.6 s long), someone else's next words.
    const at = 2 + count + 1
    s.interim("And I'm Pria", at, OTHER)
    expect(s.shows(), "the tentative name's line").toEqual({ kind: 'line', text: 'Pria' })
    s.clock.advance(LINE_MS + 100)
    expect(s.shows()).toEqual({ kind: 'dot' })
    expect(s.session.names.list()).toEqual([...NAMES.slice(0, count), 'Pria'])
    return { ...s, at }
  }

  it('keeps a later page in view when a name is confirmed while it shows', () => {
    const { session, shows, pageOf, final, at, views } = withTentative(30)
    session.tap()
    for (let i = 0; i < 3; i++) session.swipeDown()
    expect(shows(), 'the fourth page').toEqual(pageOf(21))
    const sent = views.length
    final("And I'm Pria.", at, OTHER)
    expect(session.names.confirmedList()).toContain('Pria')
    expect(shows(), 'the fourth page, still in view').toEqual(pageOf(21))
    expect(views.slice(sent).every((v) => v.kind === 'names' && v.names[0] === NAMES[21]), 'never back to the first page').toBe(true)
    // And on down from there: the last page now ends with the confirmed name.
    session.swipeDown()
    expect(shows()).toEqual({ kind: 'names', names: [...NAMES.slice(28, 30), 'Pria'] })
  })

  it('keeps a later page in view when a name past it is withdrawn while it shows', () => {
    const { session, shows, pageOf, final, at, views } = withTentative(30)
    session.tap()
    for (let i = 0; i < 3; i++) session.swipeDown()
    expect(shows(), 'the fourth page').toEqual(pageOf(21))
    const sent = views.length
    final('And I agree.', at, OTHER)
    expect(session.names.list()).toEqual(NAMES)
    expect(shows(), 'the fourth page, still in view').toEqual(pageOf(21))
    expect(views.slice(sent).every((v) => v.kind === 'names' && v.names[0] === NAMES[21]), 'never back to the first page').toBe(true)
  })

  it('moves to the page before, never an empty names box, when the only name on the last page is withdrawn', () => {
    const count = NAMES_PER_PAGE * 4
    const { session, shows, pageOf, final, at, views } = withTentative(count)
    session.tap()
    for (let i = 0; i < 4; i++) session.swipeDown()
    expect(shows(), 'the last page, its one name').toEqual({ kind: 'names', names: ['Pria'] })
    const sent = views.length
    final('And I agree.', at, OTHER)
    expect(session.names.list()).toEqual(NAMES.slice(0, count))
    expect(shows(), 'the page before, the last names').toEqual(pageOf(count - NAMES_PER_PAGE))
    expect(views.slice(sent).some((v) => v.kind === 'names' && v.names.length === 0), 'an empty names box reached the lens').toBe(false)
    // Its last name is the last held: down turns to the promises page, up scrolls back a page.
    session.swipeUp()
    expect(shows()).toEqual(pageOf(count - 2 * NAMES_PER_PAGE))
  })
})
