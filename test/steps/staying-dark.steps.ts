import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { findIntroductions } from '../../server/src/catch/introductions.ts'
import {
  begin,
  expectDotOnly,
  isDotOnly,
  isLine,
  isPage,
  LINE_MS,
  lineIn,
  linesShown,
  namesOn,
  PAGE_MS,
  pend,
  playTo,
  promisesOn,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  tapForPage,
  tapToPromises,
  untilDot,
  visible,
  type LensWorld,
} from './lens-world.ts'

// staying-dark.feature, the three scenarios P1a binds (D14, D16, D37), and
// D32's, whose catch is Dev's promise (P5): the names page is up when Dev
// promises the deck, and his line takes its place at once (the newest wins);
// the promise is held in the owed list all the same. Pause stays
// scenario-scoped wip for P6. Every "sees" is read from
// the bridge stub's record on fixture time (lens-world.ts). The fixture is
// three minutes of talk with Dev (test/fixtures/scripts.ts, `small-talk`), on
// the default split, wearer louder.

const TALK = 'small-talk.wearer-louder'

/** D32: Dev introduces himself, the scenario taps once his line has faded, and Dev promises the deck while the names page is up. */
const NEWEST = 'newest-wins.wearer-louder'

/** D89: a promise line within three seconds. */
const PROMISE_BOUND_MS = 3000

/** The owed line the lens shows for Dev's promise (P5): who promised, then the action. */
const DEV_LINE = 'Dev promised · send the deck'

/**
 * D37's "the moment Catch can hear again": the dot is back within a second of
 * the provider answering, and the server knocks at least that often while it
 * is gone, so the moment does not depend on where in the outage the provider returns.
 */
const MOMENT_MS = 1000
/**
 * The outage, in fixture seconds: one minute, ending on a whole second that a
 * one-second retry meets and a two-, three-, four- or five-second one does
 * not (operator, P1b: a 5 s retry must turn this red; at exactly 60 s every
 * retry dividing sixty would meet the provider's return).
 */
const OUTAGE_S = 61

const stayingDark: Definer<LensWorld> = (reg) => {
  // D14
  reg.define(/^the wearer is in a conversation in which nothing has slipped$/, async (w) => {
    await begin(w)
    pend(w, 'in-conversation, dot only')
    await startRun(w, TALK, 8)
  })

  reg.define(/^any moment of that conversation passes$/, async (w) => {
    await playTo(w, 25)
  })

  reg.define(/^the wearer sees a single dim dot at the lowest brightness in the top-right corner of the lens$/, (w) => {
    // At every moment since the conversation's fixture began, not only the last one.
    for (const s of screensDuring(w.h!, w.dotSince!, w.h!.clock.now())) expectDotOnly(s, 'during the conversation')
  })

  reg.define(/^the wearer sees nothing else on the lens$/, (w) => {
    for (const s of screensDuring(w.h!, w.dotSince!, w.h!.clock.now())) {
      expect(visible(s), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toHaveLength(1)
    }
  })

  // D16
  reg.define(/^the wearer is talking with Dev for three minutes$/, async (w) => {
    await begin(w)
    const run = await startRun(w, TALK, 0)
    const words = run.fixture.words
    expect(words.at(-1)!.end, 'the talk lasts three minutes').toBeGreaterThanOrEqual(180)
    expect(words.some((wd) => wd.role === 'wearer' && wd.start < 5)).toBe(true)
    expect(run.fixture.lines.filter((l) => l.who !== 'wearer').every((l) => l.who === 'Dev'), 'the wearer talks with Dev alone').toBe(true)
  })

  reg.define(
    /^in those three minutes nobody introduces themselves, the wearer makes no promise, and nobody cuts the wearer off$/,
    (w) => {
      const lines = w.run!.fixture.lines
      // Nobody introduces themselves: the detector finds no name in anything said.
      for (const l of lines) expect(findIntroductions(l.text.split(/\s+/)), `"${l.text}"`).toEqual([])
      // The wearer makes no promise: no "I'll", "I will", "I promise", "let me".
      for (const l of lines.filter((x) => x.who === 'wearer')) expect(l.text).not.toMatch(/\b(i'll|i will|i promise|let me)\b/i)
      // Nobody cuts the wearer off: every wearer line ends its sentence, and Dev waits a second before answering.
      const words = w.run!.fixture.words
      for (let i = 1; i < words.length; i++) {
        if (words[i - 1]!.role === 'wearer' && words[i]!.role === 'other') {
          expect(words[i - 1]!.text).toMatch(/[.!?]$/)
          expect(words[i]!.start - words[i - 1]!.end).toBeGreaterThanOrEqual(0.99)
        }
      }
    },
  )

  reg.define(/^the three minutes pass$/, async (w) => {
    await playTo(w, 180)
  })

  reg.define(/^the wearer has seen nothing on the lens but the dim dot for the whole three minutes$/, (w) => {
    const during = screensDuring(w.h!, w.dotSince!, w.run!.at(180))
    expect(during.length).toBeGreaterThan(0)
    for (const s of during) expectDotOnly(s, 'in the three minutes')
  })

  // D32 (P5): the newest catch, Dev's promise, replaces the names page.
  reg.define(/^the wearer has tapped and the names page is showing$/, async (w) => {
    const h = await begin(w)
    const run = await startRun(w, NEWEST, 0)
    const dev = lineIn(run, "Hi, I'm Dev.")
    expect(dev.words.every((wd) => wd.role === 'other'), 'Dev introduces himself').toBe(true)
    // Dev's name line has come and gone; the wearer has spoken, so the conversation is under way.
    await playTo(w, 3.5)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text)).toEqual(['Dev'])
    expect(run.fixture.words.some((wd) => wd.role === 'wearer' && wd.end < 3.5)).toBe(true)
    await untilDot(w)
    const page = await tapForPage(w)
    expect(namesOn(page), 'the names page').toEqual(['Dev'])
  })

  reg.define(/^Dev says "([^"]+)"$/, async (w, wordsArg) => {
    const h = w.h!
    const said = lineIn(w.run!, `${String(wordsArg)}.`)
    expect(said.words.every((wd) => wd.role === 'other'), 'Dev, not the wearer, says it').toBe(true)
    // He says it while the names page is up, and it is still up when he finishes.
    expect(w.run!.at(said.start)).toBeGreaterThan(w.page!.at)
    expect(w.run!.at(said.end), "Dev finishes before the page's five seconds are out").toBeLessThan(w.page!.at + PAGE_MS)
    await playTo(w, said.end)
    for (const s of screensDuring(h, w.page!.at, h.clock.now())) expect(visible(s), 'the names page until Dev finishes').toEqual(visible(w.page!))
    w.saidAt = w.run!.at(said.end)
    await playTo(w, said.end + (PROMISE_BOUND_MS + SLACK_MS) / 1000)
  })

  reg.define(/^the wearer sees the promise line in place of the names page at once$/, (w) => {
    const h = w.h!
    const all = screens(h)
    const next = all[all.findIndex((s) => s.at === w.page!.at) + 1]
    expect(next, 'nothing replaced the names page').toBeDefined()
    // The line takes the page's place: the very next thing on the lens, alone, dim, in the lower third.
    expect(isLine(next!, DEV_LINE), `the names page gave way to ${JSON.stringify(visible(next!).map((c) => c.content))}`).toBe(true)
    expect(next!.at - w.saidAt!, `the line came ${next!.at - w.saidAt!} ms after Dev's words`).toBeLessThanOrEqual(PROMISE_BOUND_MS)
    expect(next!.at - w.page!.at, 'while the page was still up').toBeLessThan(PAGE_MS)
    w.lineAt = next!.at
  })

  reg.define(/^the wearer no longer sees the names page$/, async (w) => {
    const h = w.h!
    // Past the line's second and a half and the page's own five seconds: the page never comes back.
    await playTo(w, w.run!.seconds(Math.max(w.lineAt! + LINE_MS, w.page!.at + PAGE_MS)) + SLACK_MS / 1000)
    for (const s of screensDuring(h, w.lineAt!, h.clock.now())) expect(isPage(s), `the names page is back at ${s.at} ms`).toBe(false)
    const after = screens(h).find((s) => s.at > w.lineAt!)
    expect(after, 'the line never went').toBeDefined()
    expectDotOnly(after, 'when the line goes')
  })

  reg.define(/^a tap and a swipe down show "([^"]+)" held for this conversation$/, async (w, heldArg) => {
    await untilDot(w)
    const page = await tapToPromises(w, ['Dev'])
    expect(promisesOn(page), 'the promises page').toEqual([String(heldArg)])
  })

  // D37
  reg.define(/^the wearer is mid-conversation and the lens shows only the dot$/, async (w) => {
    await begin(w)
    pend(w, 'in-conversation, dot only')
    await startRun(w, TALK, 10)
  })

  reg.define(/^Catch loses its connection to speech-to-text for one minute$/, async (w) => {
    const h = w.h!
    w.lostAt = h.clock.now()
    h.stt.loseConnection()
    // The conversation goes on while Catch cannot hear.
    await playTo(w, w.run!.seconds(w.lostAt) + OUTAGE_S)
    w.restoredAt = h.clock.now()
    h.stt.restore()
  })

  reg.define(/^the wearer sees no dot for that minute$/, (w) => {
    const h = w.h!
    const gone = screens(h).find((s) => s.at >= w.lostAt! && !isDotOnly(s))
    expect(gone, 'the dot never went').toBeDefined()
    expect(gone!.at - w.lostAt!, `the dot went ${gone!.at - w.lostAt!} ms after the connection dropped`).toBeLessThanOrEqual(SLACK_MS)
    for (const s of screensDuring(h, gone!.at, w.restoredAt!)) {
      expect(visible(s), `at ${s.at} ms, while Catch cannot hear, the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toEqual([])
    }
  })

  reg.define(/^the wearer sees the dot return the moment Catch can hear again$/, async (w) => {
    const h = w.h!
    await playTo(w, w.run!.seconds(w.restoredAt!) + 3)
    // While the provider was gone the server kept knocking, never more than a moment apart ...
    const knocks = [w.lostAt!, ...h.stt.attempts.filter((at) => at > w.lostAt! && at < w.restoredAt!), w.restoredAt!]
    expect(knocks.length, 'the server never tried the provider again while it was gone').toBeGreaterThan(2)
    for (let i = 1; i < knocks.length; i++) {
      expect(knocks[i]! - knocks[i - 1]!, `the server went ${knocks[i]! - knocks[i - 1]!} ms without trying the provider`).toBeLessThanOrEqual(MOMENT_MS + SLACK_MS)
    }
    // ... and Catch can hear again when the provider takes a stream once more.
    const heard = h.stt.opened.find((at) => at >= w.restoredAt!)
    expect(heard, 'the server never opened a new speech-to-text stream').toBeDefined()
    expect(heard! - w.restoredAt!, `the server took ${heard! - w.restoredAt!} ms to reach the provider again`).toBeLessThanOrEqual(MOMENT_MS + SLACK_MS)
    const back = screens(h).find((s) => s.at >= w.restoredAt! && isDotOnly(s))
    expect(back, 'the dot never came back').toBeDefined()
    expect(back!.at).toBeGreaterThanOrEqual(heard!)
    expect(back!.at - heard!, `the dot came back ${back!.at - heard!} ms after Catch could hear`).toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(back, 'when Catch can hear again')
    expectDotOnly(screenAt(h, h.clock.now()), 'now')
  })
}

export default stayingDark
