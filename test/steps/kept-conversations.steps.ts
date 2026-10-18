import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { linesOf } from '../harness/notifications.ts'
import {
  expectDotNow,
  expectFlat,
  expectInOrder,
  expectLineForASecondAndAHalfAfter,
  expectPrompt,
  expectTermsBold,
  heard,
  KEEP_PROMPT,
  keepNow,
  keptWithin,
  lineAfter,
  longPressNow,
  norm,
  openKept,
  startSkipping,
  swipeDownOnce,
  swipeUp,
  tapOnce,
  type JoggerWorld,
} from './jogger-world.ts'
import {
  begin,
  expectDotOnly,
  expectLineForASecondAndAHalf,
  fastForward,
  isDotOnly,
  isLine,
  LINE_MS,
  lineIn,
  linesShown,
  namesOn,
  nowSec,
  pend,
  playTo,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  tapForPage,
  visible,
  waitFor,
} from './lens-world.ts'

// kept-conversations.feature (P4): the keep on the lens, and the jogger on the
// phone. "The wearer sees" on the lens reads the bridge stub's record on
// fixture time (lens-world.ts); "the phone" is the notification capture and
// "opening it" the plugin's phone page handed the notification's data, with
// the jogger it draws checked against the store and against the fixture's
// own lines: the technical terms marked in the script (`terms`) must be in
// bold, every bold span must be something Catch heard, the questions (`ask`)
// and the wearer's promises must be among the bullets, and all of it in the
// order it was said (jogger-world.ts). The default split, loudness (D126), on
// the wearer-louder fixtures (D127). "Everything survives a restart" is P9's
// and stays wip.

const V = 'wearer-louder'

/** D89: a promise line within three seconds, then its second and a half. */
const PROMISE_DONE_S = (3000 + LINE_MS + SLACK_MS) / 1000

/** D116: thirty seconds under an hour; "a few minutes" beyond it, read as three at most. */
const WITHIN: Record<string, number> = { '30 seconds': 30_000, 'a few minutes': 3 * 60_000 }

/** The kept conversation of each length: its fixture, and the fixture second it ends at (a long-press). */
const LENGTHS: Record<string, { fixture: string; end: number }> = {
  '2 minutes': { fixture: 'booth-chat', end: 120 },
  '25 minutes': { fixture: 'lab-call', end: 1500 },
  '3 hours': { fixture: 'workshop', end: 10_800 },
}

/** Where each kept fixture is kept: after its first name line has come and gone. */
const KEEP_AT_S = 7

interface KeptWorld extends JoggerWorld {
  /** The prompt is to come in the When's fixture (D41, D42: the Given says the prompt is up; the When says what happens next). */
  promptPending?: boolean
  /** The fixture second the conversation was asked to end at. */
  endAt?: number
  /** The span Catch could not hear (D53), fixture seconds. */
  deaf?: { from: number; to: number }
}

/** The wearer is in a conversation (the first speech began it) and the lens has shown only the dot. */
async function midConversation(w: KeptWorld, fixture: string, upTo: number): Promise<void> {
  await begin(w)
  pend(w, 'in-conversation, dot only')
  await startRun(w, fixture, upTo)
  expectDotOnly(screenAt(w.h!, w.h!.clock.now()), 'mid-conversation')
}

/** Plays a kept fixture to the keep, keeps it, and checks the name it opened with was caught. */
async function keptFixture(w: KeptWorld, fixture: string): Promise<void> {
  await begin(w)
  const run = await startSkipping(w, `${fixture}.${V}`, KEEP_AT_S)
  const named = run.fixture.lines.find((l) => /^Hi, I'm \w+\./.test(l.text))
  if (named) expect(linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text), 'the name the conversation opened with').toEqual([named.who])
  await keepNow(w)
}

/** Plays on to fixture second `t`, keeping every promise line the lens showed. */
async function playOnTo(w: KeptWorld, t: number): Promise<void> {
  const run = w.run!
  // The wearer speaks at least every ten minutes up to `t`, so quiet has not ended the conversation (D92).
  const wearerAt = run.fixture.words.filter((wd) => wd.role === 'wearer' && wd.start < t).map((wd) => wd.start)
  for (let i = 1; i < wearerAt.length; i++) expect(wearerAt[i]! - wearerAt[i - 1]!, 'the wearer spoke within ten minutes').toBeLessThan(600)
  expect(t - wearerAt.at(-1)!, 'the wearer spoke within ten minutes of the end').toBeLessThan(600)
  const lastSaid = run.fixture.words.filter((wd) => wd.end <= t).at(-1)!
  await fastForward(w, Math.min(t, lastSaid.end + PROMISE_DONE_S))
  if (t > nowSec(w)) await fastForward(w, t)
  w.promised = linesShown(w.h!, w.dotSince!, w.h!.clock.now())
    .map((l) => l.text)
    .filter((l) => l.startsWith('promised · '))
    .map((l) => l.slice('promised · '.length))
  w.endAt = t
}

const kept: Definer<KeptWorld> = (reg) => {
  // D40
  reg.define(/^the wearer is mid-conversation and the lens shows only the dot$/, async (w) => {
    await midConversation(w, `small-talk.${V}`, 5)
  })

  reg.define(/^the wearer swipes up$/, async (w) => {
    swipeUp(w)
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees "keep this conversation\?" in dim text$/, async (w) => {
    await expectPrompt(w)
    // It waits for an answer: still up a second and a half later, when a catch line would have gone (D40).
    await playTo(w, w.run!.seconds(w.promptAt!) + (LINE_MS + 2 * SLACK_MS) / 1000)
    for (const s of screensDuring(w.h!, w.promptAt!, w.h!.clock.now())) expect(isLine(s, KEEP_PROMPT), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
  })

  // D40, D111
  reg.define(/^the lens shows "keep this conversation\?"$/, async (w) => {
    await midConversation(w, `small-talk.${V}`, 5)
    swipeUp(w)
    await expectPrompt(w)
  })

  reg.define(/^the wearer taps the glasses$/, async (w) => {
    tapOnce(w)
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees "(kept|already kept)" in dim text for a second and a half$/, async (w, textArg) => {
    await expectLineForASecondAndAHalfAfter(w, String(textArg), w.gestureAt!)
  })

  reg.define(/^the wearer then sees only the dot$/, async (w) => {
    const h = w.h!
    const all = screens(h)
    // The screen after the line is the dot, and nothing else has come since.
    const line = all.filter((s) => s.at >= w.gestureAt! && visible(s).length === 1 && !isDotOnly(s)).at(0)!
    const after = all[all.indexOf(line) + 1]!
    await playTo(w, nowSec(w) + 1)
    expectDotNow(w, after.at)
  })

  reg.define(/^a further swipe up shows "(already kept|keep this conversation\?)"(?: again)?$/, async (w, textArg) => {
    const at = swipeUp(w)
    await lineAfter(w, String(textArg), at)
  })

  // D40: a swipe down declines.
  reg.define(/^the wearer swipes down$/, async (w) => {
    swipeDownOnce(w)
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees only the dot$/, async (w) => {
    const h = w.h!
    const at = w.gestureAt!
    const back = screens(h).find((s) => s.at >= at)
    expect(back, 'the swipe down changed nothing on the lens').toBeDefined()
    expect(back!.at - at, 'the prompt went at the swipe').toBeLessThanOrEqual(SLACK_MS)
    await playTo(w, nowSec(w) + (LINE_MS + SLACK_MS) / 1000)
    expectDotNow(w, back!.at)
  })

  // D41, D42: the Given's prompt comes up in the When's fixture, before what the When is about.
  reg.define(/^the wearer has swiped up and the lens shows "keep this conversation\?"$/, async (w) => {
    await begin(w)
    w.promptPending = true
  })

  reg.define(/^Dev asks the wearer something and the wearer does not touch the glasses for forty seconds$/, async (w) => {
    const run = await startRun(w, `keep-distraction.${V}`, 3)
    expect(w.promptPending).toBe(true)
    expectDotOnly(screenAt(w.h!, w.h!.clock.now()), 'before the swipe up')
    swipeUp(w)
    await expectPrompt(w)
    const question = run.fixture.lines.find((l) => l.who === 'Dev' && l.text.endsWith('?'))!
    const asked = lineIn(run, question.text)
    expect(asked.start, 'Dev asks after the prompt is up').toBeGreaterThan(run.seconds(w.promptAt!))
    expect(asked.end, 'and inside the forty seconds').toBeLessThan(run.seconds(w.promptAt!) + 40)
    // Forty seconds of fixture time with no touch; the silences between the lines are skipped, every timer still firing on the way.
    await fastForward(w, run.seconds(w.promptAt!) + 40)
  })

  reg.define(/^the wearer still sees "keep this conversation\?" at the end of the forty seconds$/, (w) => {
    const h = w.h!
    expect(h.clock.now() - w.promptAt!, 'forty seconds have passed').toBeGreaterThanOrEqual(40_000)
    for (const s of screensDuring(h, w.promptAt!, h.clock.now())) expect(isLine(s, KEEP_PROMPT), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
  })

  reg.define(/^a further swipe up shows the prompt, not "already kept"$/, async (w) => {
    const h = w.h!
    const at = swipeUp(w)
    await playTo(w, nowSec(w) + (LINE_MS + SLACK_MS) / 1000)
    for (const s of screensDuring(h, at, h.clock.now())) expect(isLine(s, KEEP_PROMPT), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
  })

  reg.define(/^Priya says "Hi, I'm Priya"$/, async (w) => {
    const run = await startRun(w, `priya.${V}`, 2)
    expect(w.promptPending).toBe(true)
    expectDotOnly(screenAt(w.h!, w.h!.clock.now()), 'before the swipe up')
    swipeUp(w)
    await expectPrompt(w)
    const said = lineIn(run, "Hi, I'm Priya.")
    expect(said.start, 'Priya speaks while the prompt is up').toBeGreaterThan(run.seconds(w.promptAt!))
    w.saidAt = run.at(said.end)
  })

  reg.define(/^the wearer sees "Priya" in place of the prompt for a second and a half$/, async (w) => {
    const h = w.h!
    await expectLineForASecondAndAHalf(w, 'Priya')
    const before = screens(h).filter((s) => s.at < w.lineAt!).at(-1)!
    expect(isLine(before, KEEP_PROMPT), 'the prompt was up when the name came').toBe(true)
  })

  reg.define(/^the wearer then sees "keep this conversation\?" again$/, async (w) => {
    const h = w.h!
    const back = screens(h).find((s) => s.at > w.lineAt!)!
    expect(isLine(back, KEEP_PROMPT), `after the name the lens shows ${JSON.stringify(visible(back).map((c) => c.content))}`).toBe(true)
    // And it stays: no timer takes it (D40).
    await playTo(w, w.run!.seconds(back.at) + 5)
    for (const s of screensDuring(h, back.at, h.clock.now())) expect(isLine(s, KEEP_PROMPT)).toBe(true)
  })

  reg.define(/^a tap shows "Priya" among the held names once the prompt has been answered$/, async (w) => {
    // Answered with a swipe down (D40); then the bare dot, and a tap brings the names page.
    swipeDownOnce(w)
    await waitFor(w, () => (isDotOnly(screenAt(w.h!, w.h!.clock.now())!) ? true : undefined), SLACK_MS * 2)
    const page = await tapForPage(w)
    expect(namesOn(page)).toContain('Priya')
  })

  // D54
  reg.define(/^the wearer has already kept the current conversation and the lens shows only the dot$/, async (w) => {
    await midConversation(w, `small-talk.${V}`, 5)
    await keepNow(w)
  })

  reg.define(/^the wearer swipes up again$/, async (w) => {
    swipeUp(w)
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
  })

  // D24, D99
  reg.define(/^the wearer has been on a twenty-five-minute call with Ana, a PhD candidate, about joining her lab$/, async (w) => {
    await begin(w)
    const run = await startSkipping(w, `lab-call.${V}`, KEEP_AT_S)
    expect(linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text), 'Ana introduced herself').toEqual(['Ana'])
    expect(run.fixture.lines.some((l) => /\blab\b/.test(l.text)), 'the call is about her lab').toBe(true)
    w.endAt = LENGTHS['25 minutes']!.end
  })

  reg.define(/^during it the wearer swiped up and tapped to keep the conversation$/, async (w) => {
    await keepNow(w)
    await playOnTo(w, w.endAt!)
  })

  reg.define(/^the conversation ends$/, async (w) => {
    expect(nowSec(w), 'the conversation ran its length').toBeGreaterThanOrEqual(w.endAt!)
    await longPressNow(w)
  })

  reg.define(/^the phone shows a notification reading "([^"]+)"$/, async (w, textArg) => {
    const n = await keptWithin(w, WITHIN['30 seconds']!)
    expect(linesOf(n.notification)).toEqual(['Catch', String(textArg)])
  })

  reg.define(/^opening it shows one flat list of short bullets in the order things came up, with no sections$/, async (w) => {
    const jogger = await openKept(w)
    const lines = w.run!.fixture.lines
    expectFlat(jogger, heard(lines), lines.length)
    expect(jogger.names, 'the header names who was caught').toBe('Ana')
    expect(jogger.length, 'and the length').toBe('25 min')
    expectInOrder(jogger, lines, w.promised)
  })

  reg.define(/^the wearer sees the technical terms Ana used set in bold inside the bullets$/, (w) => {
    expectTermsBold(w.jogger!, w.run!.fixture.lines, 'Ana')
  })

  reg.define(/^the wearer sees the questions raised and the wearer's own promises among the bullets$/, (w) => {
    const bullets = w.jogger!.bullets.map((b) => b.text)
    const asks = w.run!.fixture.lines.filter((l) => l.ask)
    expect(asks.length, 'questions were raised').toBeGreaterThan(0)
    for (const l of asks) expect(bullets.some((b) => norm(b).includes(norm(l.ask!))), `"${l.text}" is not among the bullets: ${JSON.stringify(bullets)}`).toBe(true)
    expect(w.promised!.length, 'the wearer promised something, seen on the lens').toBeGreaterThan(0)
    for (const p of w.promised!) expect(bullets, `the promise "${p}" is not among the bullets`).toContain(`You promised: ${p}`)
  })

  // D24, D62, D74, D116
  reg.define(/^the wearer kept a conversation of (2 minutes|25 minutes|3 hours)$/, async (w, lengthArg) => {
    const { fixture, end } = LENGTHS[String(lengthArg)]!
    await keptFixture(w, fixture)
    await playOnTo(w, end)
  })

  reg.define(/^the phone shows a "Kept" notification within (30 seconds|a few minutes)$/, async (w, withinArg) => {
    const n = await keptWithin(w, WITHIN[String(withinArg)]!)
    expect(linesOf(n.notification)[1], 'a kept notification').toMatch(/^Kept: conversation /)
  })

  reg.define(/^opening it shows one flat list of bullets with no sections, as many as the specifics demand$/, async (w) => {
    const jogger = await openKept(w)
    const lines = w.run!.fixture.lines
    expectFlat(jogger, heard(lines), lines.length)
    // As many as the specifics demand: every specific is there, in bold, in the order said, never cut short.
    expectTermsBold(jogger, lines)
    expectInOrder(jogger, lines, w.promised)
  })

  // D53
  reg.define(/^the wearer has marked a conversation to keep$/, async (w) => {
    await begin(w)
    await startSkipping(w, `kept-gap.${V}`, 3)
    await keepNow(w)
  })

  reg.define(/^partway through it Catch could not hear for four minutes$/, async (w) => {
    const h = w.h!
    const run = w.run!
    await fastForward(w, 20)
    const lostAt = h.clock.now()
    h.stt.loseConnection()
    // The dot goes before the silence is skipped (D37).
    const gone = await waitFor(w, () => screens(h).find((s) => s.at >= lostAt && visible(s).length === 0), 2000)
    expect(gone, 'the dot went when Catch stopped hearing').toBeDefined()
    expect(gone!.at - lostAt).toBeLessThanOrEqual(SLACK_MS)
    await fastForward(w, 260)
    h.stt.restore()
    await waitFor(w, () => (isDotOnly(screenAt(h, h.clock.now())!) ? true : undefined), 3000)
    // Catch could not hear, seen on the lens: no dot from the loss until the provider was back (D37).
    const deaf = screensDuring(h, gone!.at, run.at(260))
    for (const s of deaf) expect(visible(s), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))} while Catch cannot hear`).toEqual([])
    const back = screens(h).find((s) => s.at > run.at(260) && isDotOnly(s))!
    expect((back.at - lostAt) / 60_000, 'four minutes not heard').toBeCloseTo(4, 1)
    w.deaf = { from: 20, to: 260 }
    // Something was said meanwhile, and never heard.
    expect(run.fixture.words.some((wd) => wd.start > 20 && wd.end < 260)).toBe(true)
  })

  reg.define(/^the conversation ends and the jogger is written$/, async (w) => {
    await playOnTo(w, 300)
    await longPressNow(w)
    await keptWithin(w, WITHIN['30 seconds']!)
    await openKept(w)
  })

  reg.define(/^the wearer sees one line in the jogger reading "([^"]+)"$/, (w, textArg) => {
    const jogger = w.jogger!
    const run = w.run!
    const bullets = jogger.bullets.map((b) => b.text)
    const gap = bullets.filter((b) => b === String(textArg))
    expect(gap, `the jogger: ${JSON.stringify(bullets)}`).toHaveLength(1)
    // Where it fell: what was said before the gap comes before it, what after, after; what was said in it, nowhere.
    const at = bullets.indexOf(String(textArg))
    const said = (from: number, to: number) => run.fixture.lines.filter((l) => lineIn(run, l.text).start >= from && lineIn(run, l.text).end <= to)
    const before = said(0, w.deaf!.from).flatMap((l) => l.terms ?? [])
    const after = said(w.deaf!.to, Infinity).flatMap((l) => l.terms ?? [])
    const missed = said(w.deaf!.from, w.deaf!.to)
    expect(before.length > 0 && after.length > 0, 'the fixture marks terms either side of the gap').toBe(true)
    for (const t of before) expect(bullets.findIndex((b) => norm(b).includes(norm(t))), `"${t}" was said before the gap`).toBeLessThan(at)
    for (const t of after) expect(bullets.findIndex((b) => norm(b).includes(norm(t))), `"${t}" was said after the gap`).toBeGreaterThan(at)
    for (const l of missed) {
      for (const word of l.text.split(/\s+/).map(norm).filter((x) => x.length >= 5)) {
        for (const b of bullets) expect(norm(b).split(' '), `"${word}" was said while Catch could not hear, yet the jogger has it`).not.toContain(word)
      }
    }
  })

  reg.define(/^the wearer sees no time of day beside it$/, (w) => {
    const bullets = w.jogger!.bullets.map((b) => b.text)
    const at = bullets.indexOf('4 minutes not heard')
    // The line itself says how long and nothing else, and no bullet beside it says when.
    expect(bullets[at]).toBe('4 minutes not heard')
    for (const b of bullets.slice(Math.max(0, at - 1), at + 2)) {
      expect(b, `"${b}" says when`).not.toMatch(/\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(am|pm|a\.m\.|p\.m\.)(?![\p{L}])|\bo'clock\b|\baround\b|\bat (noon|midnight)\b/iu)
    }
  })
}

export default kept
