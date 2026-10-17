import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { findIntroductions } from '../../server/src/catch/introductions.ts'
import {
  begin,
  CANVAS,
  expectDotOnly,
  fastForward,
  isDotOnly,
  isPage,
  LINE_MS,
  lineIn,
  linesShown,
  NAME_BOUND_MS,
  namesOn,
  nowSec,
  PAGE_MS,
  playTo,
  quoted,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  tap,
  tapForPage,
  visible,
  waitFor,
  type LensWorld,
  type Screen,
} from './lens-world.ts'

// holding.feature (P1b): the names page, its five seconds, the empty page,
// and the lens half of the conversation's end (quiet and the long-press). The
// promises page is P2a's, scrolling P10's; the phone's half of the end binds
// in P2a, and the keep in "A long-press ends the conversation now" in P4, so
// those two scenarios stay scenario-scoped wip and these bindings of their
// lens steps first run then. Every "sees" and every "a tap shows" is read from
// the bridge stub's record on fixture time (lens-world.ts). The default split,
// loudness (D126), on the wearer-louder fixtures (D127); the session's own
// tests (server/src/catch/session.test.ts) hold the same rules on any split.

const V = 'wearer-louder'

/** How long after a line is said it has come and gone: D17's two seconds, a second and a half, and the slack. */
const LINE_DONE_S = (NAME_BOUND_MS + LINE_MS + SLACK_MS) / 1000

/** The fixture second each silence's wearer goes quiet and comes back (test/fixtures/scripts.ts, `quiet`). */
const SILENCES: Record<string, { fixture: string; seconds: number }> = {
  'nine minutes': { fixture: `quiet-9min.${V}`, seconds: 540 },
  'ten minutes and one second': { fixture: `quiet-10min1s.${V}`, seconds: 601 },
}

/** The page a tap shows: the one a step before has just brought up and nobody has read yet, or a new tap's. */
async function pageFromTap(w: LensWorld): Promise<Screen> {
  if (w.page && !w.pageRead) {
    w.pageRead = true
    return w.page
  }
  const page = await tapForPage(w)
  w.pageRead = true
  return page
}

/** The lens comes back to the bare dot (a line fades), and the dot alone shows now. */
async function untilDot(w: LensWorld): Promise<void> {
  const h = w.h!
  await waitFor(w, () => (isDotOnly(screenAt(h, h.clock.now())!) ? true : undefined), LINE_MS + 2 * SLACK_MS)
  expectDotOnly(screenAt(h, h.clock.now()), 'before the tap')
}

/** Nobody introduces themselves and nobody promises anything in what the fixture says. */
function expectNothingToHold(w: LensWorld): void {
  for (const l of w.run!.fixture.lines) {
    expect(findIntroductions(l.text.split(/\s+/)), `"${l.text}"`).toEqual([])
    expect(l.text, `"${l.text}" promises something`).not.toMatch(/\b(i'll|i will|i promise|let me)\b/i)
  }
}

/** Plays the introductions of Priya, Marcus and Dana, and checks the lens caught each of them in turn. */
async function threeIntroductions(w: LensWorld, fixture: string): Promise<void> {
  const run = await startRun(w, fixture, 0)
  const dana = lineIn(run, 'Dana, nice to meet you.')
  await playTo(w, dana.end + LINE_DONE_S)
  expect(linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text), 'the names caught, in order').toEqual(['Priya', 'Marcus', 'Dana'])
  w.heldBefore = ['Priya', 'Marcus', 'Dana']
}

const holding: Definer<LensWorld> = (reg) => {
  // D43
  reg.define(/^in this conversation Priya, Marcus and Dana have each introduced themselves$/, async (w) => {
    await begin(w)
    await threeIntroductions(w, `held-page.${V}`)
  })

  reg.define(
    /^the wearer has promised to send Dev the deck and to introduce Dev to Sam, and Dev has promised to send the agenda$/,
    async (w) => {
      // Said, in the conversation; held from P2a, which binds the promises page. Here they must leave the names page alone.
      const run = w.run!
      const deck = lineIn(run, "Dev, I'll send you the deck.")
      const sam = lineIn(run, "And I'll introduce you to Sam.", deck.end)
      const agenda = lineIn(run, "Great, I'll send you the agenda.", sam.end)
      for (const line of [deck, sam]) expect(line.words.every((wd) => wd.role === 'wearer'), 'the wearer promises').toBe(true)
      expect(agenda.words.every((wd) => wd.role === 'other'), 'Dev promises').toBe(true)
      await playTo(w, agenda.end)
    },
  )

  reg.define(/^the lens shows only the dot$/, async (w) => {
    await untilDot(w)
  })

  reg.define(/^the wearer taps the glasses$/, async (w) => {
    await tapForPage(w)
  })

  reg.define(/^the wearer sees a page headed "([^"]+)" listing (.+) in that order$/, (w, headerArg, listingArg) => {
    const page = w.page!
    w.pageRead = true
    const header = visible(page).find((c) => c.containerName === 'header')
    expect(header?.content, 'the page\'s header').toBe(String(headerArg))
    expect(namesOn(page)).toEqual(quoted(String(listingArg)))
    const names = visible(page).find((c) => c.containerName === 'names')!
    // The header heads the page: above the names, at the top of the lens.
    expect(header!.box.y + header!.box.height, 'the header sits above the names').toBeLessThanOrEqual(names.box.y)
    expect(header!.box.y).toBeLessThan(CANVAS.height / 3)
  })

  reg.define(/^the wearer sees the hint "([^"]+)" at the foot of the page$/, (w, hintArg) => {
    const page = w.page!
    const hint = visible(page).find((c) => c.containerName === 'hint')
    expect(hint?.content, 'the hint').toBe(String(hintArg))
    const names = visible(page).find((c) => c.containerName === 'names')!
    expect(hint!.box.y, 'the hint sits below the names').toBeGreaterThanOrEqual(names.box.y + names.box.height)
    expect(hint!.box.y + hint!.box.height, 'the hint is on the lens').toBeLessThanOrEqual(CANVAS.height)
    expect(hint!.box.y, 'the hint is at the foot of the lens').toBeGreaterThanOrEqual((CANVAS.height * 2) / 3)
  })

  // D43, D31: the page dismisses itself after five seconds with no touch.
  reg.define(/^(three names|nothing) held in this conversation$/, async (w, heldArg) => {
    await begin(w)
    if (String(heldArg) === 'three names') {
      await threeIntroductions(w, `introductions.${V}`)
    } else {
      await startRun(w, `small-talk.${V}`, 10)
      expectNothingToHold(w)
      for (const s of screensDuring(w.h!, w.dotSince!, w.h!.clock.now())) expectDotOnly(s, 'in a conversation with nothing held')
      w.heldBefore = []
    }
  })

  reg.define(/^the wearer has tapped and a page is showing$/, async (w) => {
    await untilDot(w)
    const page = await tapForPage(w)
    expect(namesOn(page), 'the page lists what is held').toEqual(w.heldBefore)
  })

  reg.define(/^(4|5) seconds pass with no touch$/, async (w, secondsArg) => {
    // Played on past the mark by the slack a payload may take to land.
    await playTo(w, w.run!.seconds(w.page!.at) + Number(secondsArg) + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees the page still on the lens$/, (w) => {
    const h = w.h!
    const page = w.page!
    // Four seconds after it came up, and every moment until then, the page and nothing else.
    for (const s of screensDuring(h, page.at, page.at + 4000)) {
      expect(isPage(s), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
      expect(visible(s)).toEqual(visible(page))
    }
  })

  reg.define(/^the wearer sees the page gone, with only the dot in its place$/, (w) => {
    const h = w.h!
    const page = w.page!
    const all = screens(h)
    const next = all[all.findIndex((s) => s.at === page.at) + 1]
    expect(next, 'the page never went').toBeDefined()
    expect(Math.abs(next!.at - page.at - PAGE_MS), `the page stayed ${next!.at - page.at} ms`).toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(next, 'when the page goes')
    expectDotOnly(screenAt(h, h.clock.now()), 'now')
  })

  // D31
  reg.define(/^the wearer is in a conversation in which nobody has introduced themselves and nothing has been promised$/, async (w) => {
    await begin(w)
    const run = await startRun(w, `small-talk.${V}`, 10)
    expect(run.fixture.words.some((wd) => wd.role === 'wearer' && wd.end < 10), 'the conversation is under way').toBe(true)
    expectNothingToHold(w)
    for (const s of screensDuring(w.h!, w.dotSince!, w.h!.clock.now())) expectDotOnly(s, 'before the tap')
  })

  reg.define(/^the wearer sees one page reading "([^"]+)"$/, (w, textArg) => {
    const page = w.page!
    w.pageRead = true
    expect(visible(page).map((c) => c.content)).toEqual([String(textArg)])
  })

  reg.define(/^the wearer sees it go back to the dot on the next tap$/, async (w) => {
    const h = w.h!
    const page = w.page!
    const tappedAt = tap(w)
    expect(tappedAt - page.at, 'the next tap comes while the page is up').toBeLessThan(PAGE_MS - 2 * SLACK_MS)
    const back = await waitFor(w, () => screens(h).find((s) => s.at >= tappedAt && !isPage(s)))
    expect(back, 'the page did not go on the tap').toBeDefined()
    expect(back!.at - tappedAt, `the dot came back ${back!.at - tappedAt} ms after the tap`).toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(back, 'after the second tap')
  })

  // D55, D56 as D92 reads them (scenario-scoped wip until P2a binds the phone column).
  reg.define(/^the wearer is talking with Dev, Priya has introduced herself, and the wearer has promised to send Dev the deck$/, async (w) => {
    // The silence the When names picks the fixture; it checks this conversation as it starts it.
    await begin(w)
  })

  reg.define(/^the wearer says nothing for (nine minutes|ten minutes and one second) while Dev keeps talking, and then speaks again$/, async (w, silenceArg) => {
    const { fixture, seconds } = SILENCES[String(silenceArg)]!
    const run = await startRun(w, fixture, 0)
    // The conversation as the Given has it: Dev and the wearer, Priya caught, the promise said.
    const priya = lineIn(run, "Hi, I'm Priya.")
    const deck = lineIn(run, "Dev, I'll send you the deck.", priya.end)
    expect(deck.words.every((wd) => wd.role === 'wearer'), 'the wearer promises Dev the deck').toBe(true)
    await playTo(w, deck.end)
    expect(linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text)).toEqual(['Priya'])
    w.heldBefore = ['Priya']
    // The wearer's silence, to the second, with Dev talking through it until just before the wearer speaks.
    const back = lineIn(run, 'Sorry, where were we?', deck.end)
    expect(back.words.every((wd) => wd.role === 'wearer')).toBe(true)
    const between = run.fixture.words.filter((wd) => wd.start > deck.end && wd.end < back.start)
    expect(between.every((wd) => wd.role === 'other'), 'the wearer says nothing in between').toBe(true)
    expect(back.start - deck.end, `the wearer is silent for ${seconds} s`).toBeCloseTo(seconds, 3)
    const devAt = [deck.end, ...between.map((wd) => wd.start), back.start]
    for (let i = 1; i < devAt.length; i++) expect(devAt[i]! - devAt[i - 1]!, 'Dev keeps talking').toBeLessThanOrEqual(60)
    for (const l of run.fixture.lines.filter((x) => x.who === 'Dev')) expect(findIntroductions(l.text.split(/\s+/)), `"${l.text}"`).toEqual([])
    await fastForward(w, back.end)
    await playTo(w, back.end + SLACK_MS / 1000)
  })

  reg.define(/^the wearer is in (the same conversation|a new conversation)$/, async (w, whichArg) => {
    // Observed through the next tap's page (BUILD-PLAN.md, P1b); the step after reads the same page.
    const page = await tapForPage(w)
    w.pageRead = false
    if (String(whichArg) === 'the same conversation') expect(namesOn(page), 'the conversation still holds its names').toEqual(w.heldBefore)
    else expect(visible(page).map((c) => c.containerName), 'nothing from the old conversation is held').toEqual(['empty'])
  })

  reg.define(/^a tap shows "([^"]+)" on the names page$/, async (w, nameArg) => {
    const page = await pageFromTap(w)
    expect(namesOn(page)).toContain(String(nameArg))
  })

  reg.define(/^a tap shows "([^"]+)"$/, async (w, textArg) => {
    const page = await pageFromTap(w)
    expect(visible(page).map((c) => c.content)).toEqual([String(textArg)])
  })

  // D52, the lens half (scenario-scoped wip until P2a binds the phone and P4 the keep).
  reg.define(/^the wearer is twenty minutes into a conversation with Dev in which the wearer promised to send the deck tonight$/, async (w) => {
    await begin(w)
    const run = await startRun(w, `long-press.${V}`, 0)
    const deck = lineIn(run, "Dev, I'll send you the deck tonight.")
    expect(deck.words.every((wd) => wd.role === 'wearer'), 'the wearer promises Dev the deck').toBe(true)
    // The wearer speaks at least every ten minutes, so quiet has not ended it (D92).
    const wearerAt = run.fixture.words.filter((wd) => wd.role === 'wearer' && wd.start < 1200).map((wd) => wd.start)
    for (let i = 1; i < wearerAt.length; i++) expect(wearerAt[i]! - wearerAt[i - 1]!).toBeLessThan(600)
    await fastForward(w, 1200)
    expect(nowSec(w)).toBeGreaterThanOrEqual(1200)
  })

  reg.define(/^the wearer long-presses the glasses$/, async (w) => {
    const h = w.h!
    w.pressedAt = h.clock.now()
    // LONG_PRESS_EVENT (9), then its release (10), from the glasses' temple.
    h.host.push('sysEvent', { eventType: 9, eventSource: 1 })
    await playTo(w, nowSec(w) + 0.2)
    h.host.push('sysEvent', { eventType: 10, eventSource: 1 })
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
  })

  reg.define(/^the next thing the wearer says begins a new conversation$/, async (w) => {
    const h = w.h!
    const run = w.run!
    // Dana introduces herself before the wearer has spoken: no conversation is open, so nothing is caught.
    const dana = lineIn(run, "Hi, I'm Dana.", 1200)
    await fastForward(w, dana.start)
    await playTo(w, dana.end + LINE_DONE_S)
    expect(linesShown(h, w.pressedAt!, h.clock.now()), 'a name caught before the wearer spoke').toEqual([])
    // The wearer speaks, and the next introduction is caught: a conversation is open again.
    const hello = lineIn(run, 'Oh, hello again.', dana.end)
    expect(hello.words.every((wd) => wd.role === 'wearer')).toBe(true)
    const marcus = lineIn(run, "Hi, I'm Marcus.", hello.end)
    await fastForward(w, marcus.start)
    await playTo(w, marcus.end + NAME_BOUND_MS / 1000)
    const caught = linesShown(h, run.at(marcus.end), h.clock.now())
    expect(caught.map((l) => l.text)).toEqual(['Marcus'])
    expect(caught[0]!.at - run.at(marcus.end)).toBeLessThanOrEqual(NAME_BOUND_MS)
  })
}

export default holding
