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
  const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
  const say = (text: string, start: number, dbfs: number) => {
    const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
    for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) {
      session.frame({ seq: seq++, captureMs: (t / 10) * 1000, speakerRole: 'unknown', direction: null, pcm: pcmAt(dbfs) })
    }
    clock.advance(Math.max(0, words.at(-1)!.end * 1000 - clock.now()))
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
  return { clock, session, views, say, shows, pageOf }
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

  it('gives every page five seconds of its own, and a swipe up at the first name does not restart them', () => {
    const { clock, session, shows, pageOf } = setup(30)
    session.tap()
    clock.advance(PAGE_MS - 1)
    session.swipeDown()
    clock.advance(PAGE_MS - 1)
    expect(shows(), 'the second page, a moment short of its five seconds').toEqual(pageOf(7))
    clock.advance(1)
    expect(shows()).toEqual({ kind: 'dot' })
    session.tap()
    clock.advance(PAGE_MS - 1)
    session.swipeUp()
    clock.advance(1)
    expect(shows(), 'the first page went at its five seconds').toEqual({ kind: 'dot' })
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
