import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { findIntroductions } from '../../server/src/catch/introductions.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { linesOf } from '../harness/notifications.ts'
import { keepNow, keptWithin, phoneShows, storedJogger, type JoggerWorld } from './jogger-world.ts'
import {
  begin,
  CANVAS,
  expectDotOnly,
  fastForward,
  isPage,
  isPromisesPage,
  LINE_MS,
  lineIn,
  linesShown,
  LOWEST_READABLE,
  NAME_BOUND_MS,
  namesOn,
  nowSec,
  PAGE_MS,
  playTo,
  promisesOn,
  quoted,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  swipeDown,
  tap,
  tapForPage,
  untilDot,
  visible,
  waitFor,
  type LensWorld,
  type Screen,
} from './lens-world.ts'

// holding.feature (P1b, P2a, P5): the names page, its five seconds, the empty
// page, the promises page on a swipe down (P2a: the wearer's own promises and
// `no promises yet`; P5: the owed line after them, "owed: Dev sends the
// agenda", from Dev, whose name was caught, so the line names him), and the
// conversation's end on the lens and, from P2a, on the phone: the
// notification capture is the phone (D126). Scrolling (P10): thirty names
// across pages of names, each read off the bridge record in the order the
// swipes brought them, the promises page only past the last name, and the
// swipes up back through the same pages to the first, where a further swipe
// up does nothing. "A long-press
// ends the conversation now" binds its keep and the kept notification in P4
// (jogger-world.ts). Every "sees" and every "a tap shows" is
// read from the bridge stub's record on fixture time (lens-world.ts), every
// "the phone" from the capture's record. The default split,
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

/** The account the harness's glasses are signed in to: its phone is the one the notifications go to (D79). */
const ACCOUNT = wearerOf(HARNESS_TOKEN)

/** D89: a promise line within three seconds. */
const PROMISE_BOUND_MS = 3000

/** The wearer's promise lines (`promised · …`) shown in [from, to], as the lens showed them, the owed ones (`Dev promised · …`, P5), and the lens's other lines. */
function promiseLinesShown(w: LensWorld, from: number, to: number): { promises: string[]; owed: string[]; others: string[] } {
  const lines = linesShown(w.h!, from, to).map((l) => l.text)
  return {
    promises: lines.filter((l) => l.startsWith('promised · ')),
    owed: lines.filter((l) => l.includes(' promised · ')),
    others: lines.filter((l) => !l.includes('promised · ')),
  }
}

/** D89: a promise line within three seconds, and the second and a half it stays. */
const PROMISE_DONE_S = (PROMISE_BOUND_MS + LINE_MS + SLACK_MS) / 1000

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

/** Nobody promises anything in either direction in what the fixture says. */
function expectNothingPromised(w: LensWorld): void {
  for (const l of w.run!.fixture.lines) expect(l.text, `"${l.text}" promises something`).not.toMatch(/\b(i'll|i will|i promise|let me|i'm going to)\b/i)
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

/** How many lines a "first" step read off the top of the promises page, for the "after them" step. */
const firstSeen = new WeakMap<LensWorld, number>()

/**
 * The G2's text line in pixels: the firmware's LVGL line height is fixed at
 * 27 px (Even's `text-heavy` template). A capturing text container given more
 * lines than its box holds is scrolled by the firmware itself, so a page that
 * overflows would show the wearer names the bridge record cannot place (P10).
 */
const G2_LINE_PX = 27

/** The sequence of held pages the swipes brought up (P10): from the tap's names page on, in order. */
const pagesSeen = new WeakMap<LensWorld, Screen[]>()

/** A names page: its header, its names and its hint, all dim, and nothing else; its names fit its box at the G2's line height. */
function expectNamesPage(s: Screen, what: string): void {
  expect(isPage(s), `${what}: the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
  const header = visible(s).find((c) => c.containerName === 'header')
  expect(header?.content, `${what}: the header`).toBe('this conversation 1/2')
  expect(visible(s).find((c) => c.containerName === 'hint')?.content, `${what}: the hint`).toBe('↓ promises')
  for (const c of visible(s)) expect(c.brightness, `${what}: the ${c.containerName} is dim`).toBe(LOWEST_READABLE)
  const names = visible(s).find((c) => c.containerName === 'names')!
  const lines = names.content.split('\n').length
  expect(lines * G2_LINE_PX, `${what}: ${lines} names in a ${names.box.height} px box`).toBeLessThanOrEqual(names.box.height)
}

/**
 * One swipe (the SDK's SCROLL_BOTTOM_EVENT, 2, down; SCROLL_TOP_EVENT, 1, up)
 * on the container that takes the touches on the page showing, and the screen
 * it brought up: the first payload after it, within the slack, or none.
 */
async function swipeOnce(w: LensWorld, direction: 'down' | 'up'): Promise<{ at: number; shown: Screen | undefined }> {
  const h = w.h!
  const showing = screenAt(h, h.clock.now())!
  const capture = h.host.lastPayload()?.data.textObject as { containerID: number; containerName: string; isEventCapture?: number }[] | undefined
  const target = capture?.find((c) => c.isEventCapture === 1) ?? { containerID: 3, containerName: 'names' }
  const before = screens(h).length
  const at = h.clock.now()
  h.host.push('textEvent', { containerID: target.containerID, containerName: target.containerName, eventType: direction === 'down' ? 2 : 1 })
  const shown = await waitFor(w, () => screens(h).slice(before).find((s) => s.at >= at), SLACK_MS)
  expect(shown === undefined || shown.at - at <= SLACK_MS, `the swipe's page came ${shown ? shown.at - at : 0} ms after it`).toBe(true)
  expect(showing.at, 'the page was still up when the swipe came').toBeGreaterThan(at - PAGE_MS)
  return { at, shown }
}

const holding: Definer<LensWorld & JoggerWorld> = (reg) => {
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
      // Every promise line (the owed one included, P5) comes and goes before the tap the When makes. Dev never
      // introduced himself here, so his promise is named by the last name caught (P5's rule); this scenario reads
      // only the names page (P5's open question on this fixture).
      await playTo(w, agenda.end + PROMISE_DONE_S)
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

  // D43 (P10): thirty names scroll before the promises page.
  reg.define(/^in this conversation thirty people have introduced themselves in a circle$/, async (w) => {
    const h = await begin(w)
    const run = await startRun(w, `circle.${V}`, 0)
    // Thirty different people, each giving a different name, one after another, before anything else is said to them.
    const intros = run.fixture.lines.filter((l) => l.who !== 'wearer')
    const heard = intros.flatMap((l) => findIntroductions(l.text.split(/\s+/)).map((d) => d.name))
    expect(heard, 'one name in each introduction').toHaveLength(intros.length)
    expect(new Set(intros.map((l) => l.who)).size, 'thirty people').toBe(30)
    expect(new Set(heard).size, 'thirty different names').toBe(30)
    const last = lineIn(run, intros.at(-1)!.text)
    await playTo(w, last.end + (NAME_BOUND_MS + SLACK_MS) / 1000)
    // The lens caught each of them in turn, as they spoke.
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'the names caught, in the order heard').toEqual(heard)
    w.heldBefore = heard
  })

  reg.define(/^the wearer has promised to send Dev the deck$/, async (w) => {
    const run = w.run!
    const last = lineIn(run, run.fixture.lines.filter((l) => l.who !== 'wearer').at(-1)!.text)
    const deck = lineIn(run, "Dev, I'll send you the deck.", last.end)
    expect(deck.words.every((wd) => wd.role === 'wearer'), 'the wearer promises').toBe(true)
    await playTo(w, run.fixture.words.at(-1)!.end + PROMISE_DONE_S)
    const shown = promiseLinesShown(w, run.at(deck.start), w.h!.clock.now())
    expect(shown.promises, 'the promise, as the lens showed it').toEqual(['promised · send Dev the deck'])
    expect(shown.owed).toEqual([])
    expect(shown.others, 'no name caught after the circle').toEqual([])
  })

  reg.define(/^the wearer taps and then swipes down repeatedly$/, async (w) => {
    await untilDot(w)
    const pages: Screen[] = [await tapForPage(w)]
    // Down until the promises page comes; a swipe that brought nothing, or more swipes than names, stops it.
    for (let i = 0; i <= w.heldBefore!.length && !isPromisesPage(pages.at(-1)!); i++) {
      const { shown } = await swipeOnce(w, 'down')
      if (!shown) break
      pages.push(shown)
    }
    pagesSeen.set(w, pages)
    w.page = pages.at(-1)
    w.pageRead = true
  })

  reg.define(/^the wearer sees all thirty names in the order heard across the swipes$/, (w) => {
    const pages = pagesSeen.get(w)!
    const names = pages.filter((s) => !isPromisesPage(s))
    names.forEach((s, i) => expectNamesPage(s, `names page ${i + 1}`))
    expect(names.length, 'the names take more than one page').toBeGreaterThan(1)
    expect(names.flatMap(namesOn), 'the names, page after page').toEqual(w.heldBefore)
    // Each page came on its swipe, the one after it on the next: nothing else reached the lens in between.
    const all = screens(w.h!)
    const from = all.findIndex((s) => s.at === pages[0]!.at && isPage(s))
    expect(all.slice(from, from + pages.length), 'the lens showed these pages and nothing between them').toEqual(pages)
  })

  reg.define(/^the wearer sees the promises page only after the last name$/, (w) => {
    const pages = pagesSeen.get(w)!
    const at = pages.findIndex(isPromisesPage)
    expect(at, 'a swipe down turned to the promises page').toBeGreaterThan(0)
    expect(at, 'the promises page came last').toBe(pages.length - 1)
    expect(namesOn(pages[at - 1]!).at(-1), 'the page before it ends with the last name').toBe(w.heldBefore!.at(-1))
    expect(promisesOn(pages[at]!), 'the promises page').toEqual(['send Dev the deck'])
  })

  reg.define(/^a swipe up scrolls the wearer back through the names$/, async (w) => {
    const h = w.h!
    const forward = pagesSeen.get(w)!.filter((s) => !isPromisesPage(s))
    expect(isPromisesPage(screenAt(h, h.clock.now())!), 'the promises page is up').toBe(true)
    // Up from the promises page: the names pages again, last first, each on its swipe, down to the first.
    const back: Screen[] = []
    for (let i = 0; i < forward.length; i++) {
      const { shown } = await swipeOnce(w, 'up')
      expect(shown, `swipe up ${i + 1} brought nothing`).toBeDefined()
      expectNamesPage(shown!, `back, page ${forward.length - i}`)
      back.push(shown!)
    }
    expect(back.map(namesOn), 'the same pages of names, in reverse').toEqual(forward.map(namesOn).reverse())
    // At the first name a swipe up does nothing: no keep prompt, no other page; the first page stays.
    const first = screenAt(h, h.clock.now())!
    const { shown } = await swipeOnce(w, 'up')
    expect(shown, 'a swipe up at the first name changed the lens').toBeUndefined()
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
    expect(screenAt(h, h.clock.now()), 'the first page of names is still up').toEqual(first)
    expect(namesOn(first), 'the first page begins with the first name').toEqual(forward[0] ? namesOn(forward[0]) : [])
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
    // The promise is made (P2a): its line comes within three seconds of the words; Priya is the one name caught.
    await playTo(w, deck.end + (PROMISE_BOUND_MS + SLACK_MS) / 1000)
    const shown = promiseLinesShown(w, w.dotSince!, w.h!.clock.now())
    expect(shown.others, 'the names caught').toEqual(['Priya'])
    expect(shown.promises, 'the promise the lens showed').toEqual(['promised · send Dev the deck'])
    w.heldBefore = ['Priya']
    // The wearer's silence, to the second, with Dev talking through it until just before the wearer speaks.
    const back = lineIn(run, 'Sorry, where were we?', deck.end)
    expect(back.words.every((wd) => wd.role === 'wearer')).toBe(true)
    w.quietFrom = run.at(deck.end)
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

  // D92's phone column (P2a): nothing within the conversation; at its quiet end, the promise notification.
  reg.define(/^the phone has received (nothing|the promise notification at the tenth minute)$/, async (w, phoneArg) => {
    const h = w.h!
    if (String(phoneArg) === 'nothing') {
      expect(h.notifications.received, 'the phone received a notification while the conversation went on').toEqual([])
      expect(h.notifications.refused, 'a notification was even tried').toEqual([])
      return
    }
    const got = h.notifications.phone(ACCOUNT)
    expect(got.map((c) => linesOf(c.notification)), "the account holder's phone").toEqual([['Catch', 'Send Dev the deck']])
    expect(h.notifications.received, 'no other phone received anything').toEqual(got)
    // At the tenth minute of the wearer's silence, on fixture time.
    const late = got[0]!.at - (w.quietFrom! + 10 * 60_000)
    expect(Math.abs(late), `the notification came ${late} ms off the tenth minute`).toBeLessThanOrEqual(SLACK_MS)
  })

  // D52's phone half (P2a): the promise notification, beside the kept one (P4).
  reg.define(/^the phone shows the promise notification within thirty seconds$/, async (w) => {
    const h = w.h!
    await waitFor(w, () => (phoneShows(w).promises.length > 0 ? true : undefined), 30_000)
    const got = phoneShows(w).promises
    expect(got.map((c) => linesOf(c.notification)), "the account holder's phone").toEqual([['Catch', 'Send Dev the deck tonight']])
    expect(got[0]!.at - w.pressedAt!, 'within thirty seconds of the long-press').toBeLessThanOrEqual(30_000)
    expect(h.notifications.received.filter((c) => c.to !== ACCOUNT), 'no other phone').toEqual([])
  })

  // D52's keep (P4): kept during the conversation; its notification within thirty seconds of the long-press (D116).
  reg.define(/^Priya introduced herself, and the wearer swiped up and tapped to keep the conversation$/, async (w) => {
    const h = w.h!
    const run = w.run!
    const priya = lineIn(run, "Hi, I'm Priya.")
    expect(priya.words.every((wd) => wd.role === 'other'), 'Priya introduces herself').toBe(true)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text)[0], 'Priya was caught').toBe('Priya')
    await keepNow(w)
  })

  reg.define(/^the phone shows the kept-conversation notification within thirty seconds$/, async (w) => {
    const n = await keptWithin(w, 30_000)
    expect(linesOf(n.notification), 'the kept notification names the conversation by who was caught').toEqual(['Catch', 'Kept: conversation with Priya'])
    // It came with its jogger: the store holds one for the conversation it opens.
    expect(storedJogger(w, Number(n.notification.data?.conversation))?.length, 'the jogger is written').toBeGreaterThan(0)
    // The promise notification came first: the kept one waits for its jogger.
    expect(phoneShows(w).promises[0]!.at).toBeLessThanOrEqual(n.at)
  })

  // D43, D112: the promises page (P2a), the owed line after the wearer's (P5).
  reg.define(/^the names page of a conversation with two promises made and one owed is showing$/, async (w) => {
    const h = await begin(w)
    const run = await startRun(w, `owed-page.${V}`, 0)
    const dev = lineIn(run, "Hi, I'm Dev.")
    const deck = lineIn(run, "Dev, I'll send you the deck.", dev.end)
    const sam = lineIn(run, "And I'll introduce you to Sam.", deck.end)
    const agenda = lineIn(run, "Great, I'll send you the agenda.", sam.end)
    for (const line of [dev, agenda]) expect(line.words.every((wd) => wd.role === 'other'), 'Dev says it').toBe(true)
    for (const line of [deck, sam]) expect(line.words.every((wd) => wd.role === 'wearer'), 'the wearer promises').toBe(true)
    await playTo(w, run.fixture.words.at(-1)!.end + PROMISE_DONE_S)
    const shown = promiseLinesShown(w, w.dotSince!, h.clock.now())
    expect(shown.promises, 'the two promises the wearer made, as the lens showed them').toEqual(['promised · send Dev the deck', 'promised · introduce Dev to Sam'])
    expect(shown.owed, "Dev's, as the lens showed it").toEqual(['Dev promised · send the agenda'])
    expect(shown.others, 'the names caught').toEqual(['Dev'])
    await untilDot(w)
    const page = await tapForPage(w)
    expect(namesOn(page)).toEqual(['Dev'])
  })

  reg.define(/^Priya and Marcus have introduced themselves and nothing has been promised in either direction$/, async (w) => {
    const h = await begin(w)
    const run = await startRun(w, `names-only.${V}`, 0)
    await playTo(w, run.fixture.words.at(-1)!.end + LINE_DONE_S)
    expectNothingPromised(w)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'the names caught, and nothing else').toEqual(['Priya', 'Marcus'])
  })

  reg.define(/^the wearer has tapped and the names page is showing$/, async (w) => {
    await untilDot(w)
    const page = await tapForPage(w)
    expect(visible(page).find((c) => c.containerName === 'header')?.content).toBe('this conversation 1/2')
    expect(namesOn(page)).toEqual(['Priya', 'Marcus'])
  })

  reg.define(/^the wearer swipes down past the end of the names$/, async (w) => {
    const names = w.page!
    const page = await swipeDown(w)
    // The page turned: the names page was up when the swipe came, and every name on it was already in view.
    expect(page.at - names.at, 'the swipe came while the names page was up').toBeLessThan(PAGE_MS)
    w.pageRead = true
  })

  reg.define(/^the wearer sees (".+") first$/, (w, listArg) => {
    expect(promisesOn(w.page!).slice(0, quoted(String(listArg)).length), 'the promises page, from the top').toEqual(quoted(String(listArg)))
    firstSeen.set(w, quoted(String(listArg)).length)
  })

  // P5: the owed, after the wearer's own, and nothing after them.
  reg.define(/^the wearer sees "([^"]+)" after them$/, (w, owedArg) => {
    const first = firstSeen.get(w)
    expect(first, 'the step before read the first lines').toBeDefined()
    expect(promisesOn(w.page!).slice(first), 'the promises page, after the wearer\'s own').toEqual([String(owedArg)])
  })

  reg.define(/^the wearer sees the promises page reading "([^"]+)"$/, (w, textArg) => {
    expect(visible(w.page!).map((c) => c.content), 'the promises page').toEqual(['this conversation 2/2', String(textArg)])
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
