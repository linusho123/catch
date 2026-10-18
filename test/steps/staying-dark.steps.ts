import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { findIntroductions } from '../../server/src/catch/introductions.ts'
import { PAUSE_BOOTH, PAUSE_FREEZE, PAUSE_RESUME } from '../fixtures/scripts.ts'
import type { Harness } from '../harness/index.ts'
import { linesOf } from '../harness/notifications.ts'
import { find, rows } from '../harness/store-reader.ts'
import {
  ACCOUNT,
  expectLineForASecondAndAHalfAfter,
  keepNow,
  keptWithin,
  longPressNow,
  openKept,
  startSkipping,
  type JoggerWorld,
} from './jogger-world.ts'
import {
  begin,
  fastForward,
  isTopRight,
  LOWEST_READABLE,
  nowSec,
  tap,
  tapForNames,
  waitFor,
  type Screen,
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
} from './lens-world.ts'

// staying-dark.feature, the three scenarios P1a binds (D14, D16, D37), and
// D32's, whose catch is Dev's promise (P5): the names page is up when Dev
// promises the deck, and his line takes its place at once (the newest wins);
// the promise is held in the owed list all the same. P6 binds the pause's
// three (D86, D81) with the operator's switch on (CATCH_PAUSE; the harness's
// setPause, off after every reset as in the demo build). Every "sees" is read from
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

/** D89: a promise line within three seconds, then its second and a half. */
const PROMISE_DONE_S = (PROMISE_BOUND_MS + LINE_MS + SLACK_MS) / 1000

/** D81: twelve minutes paused; four of the ten-minute quiet gone before it, six left after it. */
const PAUSED_MS = 12 * 60_000
const QUIET_BEFORE_MS = 4 * 60_000
const QUIET_AFTER_MS = 6 * 60_000

/** D86: the paused mark, an en dash in the dot's place. */
const DASH = '–'

interface PauseWorld extends JoggerWorld {
  /** The fixture-clock readings of the pausing swipe and of the resuming one. */
  pausedAt?: number
  resumedAt?: number
  /** Where the dot sat before the pause: the dash takes its place. */
  dotBox?: Screen['containers'][number]['box']
}

/** Every frame that reached the server, by the clock: one listener per server, the log cleared as each pause scenario starts. */
const frameLog: number[] = []
const watched = new WeakSet<object>()
function watchFrames(h: Harness): void {
  frameLog.length = 0
  if (watched.has(h.server)) return
  watched.add(h.server)
  h.server.events.on('frame', ({ at }) => frameLog.push(at))
}

/** Starts a pause scenario: the operator's switch on (CATCH_PAUSE, P6), the lens up, the server's frames watched. */
async function beginPaused(w: PauseWorld): Promise<Harness> {
  const h = await begin(w)
  h.setPause(true)
  watchFrames(h)
  return h
}

/** SCROLL_BOTTOM_EVENT (2) on the container that takes the touches: at the bare dot, or at the dash. */
function swipeDownAtMark(w: PauseWorld): number {
  const h = w.h!
  const at = h.clock.now()
  const shown = visible(screenAt(h, at)!)
  h.host.push('textEvent', { containerID: 1, containerName: shown[0]?.containerName ?? 'dot', eventType: 2 })
  w.gestureAt = at
  return at
}

/** The dim dash alone, in the dot's place (D86): never the dot, never the empty lens of can't-hear (D37). */
function expectDash(s: Screen | undefined, dotBox: PauseWorld['dotBox'], when: string): void {
  expect(s, `no screen ${when}`).toBeDefined()
  const seen = visible(s!)
  expect(seen.map((c) => c.content), `the lens ${when} at ${s!.at} ms shows ${JSON.stringify(seen.map((c) => c.content))}`).toEqual([DASH])
  expect(seen[0]!.brightness, `the dash's brightness ${when}`).toBe(LOWEST_READABLE)
  expect(isTopRight(seen[0]!.box), `the dash sits at ${JSON.stringify(seen[0]!.box)}, not the top-right corner`).toBe(true)
  if (dotBox) expect(seen[0]!.box, "the dash is in the dot's place").toEqual(dotBox)
}

/** The bridge's audioControl calls since `from`, as the SDK sent them to the Even app: true opens the glasses' microphone. */
function micCalls(h: Harness, from: number): { at: number; data: Record<string, unknown> }[] {
  return h.host.calls.filter((c) => c.method === 'audioControl' && c.at >= from)
}

/** The swipe down that pauses: `paused`, its second and a half, then the dash (D86). Returns the dash's screen. */
async function pauseNow(w: PauseWorld): Promise<Screen> {
  const h = w.h!
  const dot = screenAt(h, h.clock.now())!
  expectDotOnly(dot, 'before the swipe down')
  w.dotBox = visible(dot)[0]!.box
  w.pausedAt = swipeDownAtMark(w)
  const after = await expectLineForASecondAndAHalfAfter(w, 'paused', w.pausedAt)
  expectDash(after, w.dotBox, 'once `paused` has gone')
  return after
}

/** Through the pause, from the dash on: the dash alone, all along; no frame reached the server once the lens heard of it. */
function expectPausedThrough(w: PauseWorld, dashAt: number, to: number): void {
  const h = w.h!
  for (const s of screensDuring(h, dashAt, to)) expectDash(s, w.dotBox, 'while paused')
  // The lens stopped streaming: the microphone closed at the swipe, and no frame reached the server after the hop that told it.
  const mic = micCalls(h, w.pausedAt!)
  expect(mic.length, 'the lens never closed the microphone').toBeGreaterThan(0)
  expect(mic.map((c) => c.data.isOpen), 'the microphone closed at the swipe, and stayed closed').toEqual([false])
  expect(mic[0]!.at - w.pausedAt!, 'the microphone closed at the swipe').toBeLessThanOrEqual(SLACK_MS)
  const late = frameLog.filter((at) => at > w.pausedAt! + SLACK_MS && at <= to)
  expect(late.map((at) => at - w.pausedAt!), 'frames reached the server while paused (ms after the swipe)').toEqual([])
}

/** The swipe down that resumes: `listening`, its second and a half, then the dot (D86). */
async function resumeNow(w: PauseWorld): Promise<Screen> {
  w.resumedAt = swipeDownAtMark(w)
  const after = await expectLineForASecondAndAHalfAfter(w, 'listening', w.resumedAt)
  return after
}

/** The words the store holds anywhere (the transcript above all) of those listed. */
const inStore = (h: Harness, words: readonly string[]) => words.filter((word) => find(h.dbPath, word).length > 0)

const stayingDark: Definer<PauseWorld> = (reg) => {
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

  // D86, with the operator's switch on (P6). The booth chat, kept at second 7
  // so a jogger is written at its end, is paused at PAUSE_BOOTH.pauseAt.
  reg.define(/^Catch is listening and the lens shows only the dot$/, async (w) => {
    const h = await beginPaused(w)
    await startSkipping(w, 'pause-booth.wearer-louder', 7)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'Marcus introduced himself').toEqual(['Marcus'])
    await keepNow(w)
    await fastForward(w, PAUSE_BOOTH.pauseAt)
    // Listening: the dot, and the lens's frames reaching the server.
    expectDotOnly(screenAt(h, h.clock.now()), 'before the swipe down')
    expect(frameLog.some((at) => at > h.clock.now() - 2000), 'the lens is streaming').toBe(true)
  })

  reg.define(/^the wearer swipes down$/, async (w) => {
    // At the bare dot it pauses; at the dash it resumes (D86). Read by the Thens that follow.
    if (w.pausedAt === undefined) {
      const dot = screenAt(w.h!, w.h!.clock.now())
      expectDotOnly(dot, 'as the wearer swipes down')
      w.dotBox = visible(dot!)[0]!.box
      w.pausedAt = swipeDownAtMark(w)
    } else {
      w.resumedAt = swipeDownAtMark(w)
    }
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees "(paused|listening)" in dim text for a second and a half$/, async (w, textArg) => {
    const text = String(textArg)
    const after = await expectLineForASecondAndAHalfAfter(w, text, text === 'paused' ? w.pausedAt! : w.resumedAt!)
    w.lineAt = after.at
  })

  reg.define(/^the wearer then sees a dim dash in the dot's place for as long as the pause lasts$/, async (w) => {
    const h = w.h!
    expectDash(screenAt(h, w.lineAt!), w.dotBox, 'once `paused` has gone')
    // The pause lasts until the second swipe: through everything said meanwhile.
    await fastForward(w, PAUSE_BOOTH.resumeAt)
    const said = w.run!.fixture.words.filter((wd) => w.run!.at(wd.start) > w.pausedAt! && wd.end < PAUSE_BOOTH.resumeAt)
    expect(said.length, 'something is said while paused').toBeGreaterThan(10)
    expectPausedThrough(w, w.lineAt!, h.clock.now())
    // The pause ends with the second swipe down, and the dash with it.
    const back = await resumeNow(w)
    const sinceDash = screens(h).filter((s) => s.at > w.lineAt!)
    expect(isLine(sinceDash[0]!, 'listening'), 'the dash held until the second swipe down').toBe(true)
    expect(sinceDash[0]!.at).toBeGreaterThanOrEqual(w.resumedAt!)
    expectDotOnly(back, 'after the pause')
  })

  reg.define(/^nothing said while paused appears on the lens, in the held pages, or in any jogger$/, async (w) => {
    const h = w.h!
    const run = w.run!
    // The lens: from the swipe on, nothing but the two status lines, the dash and the dot.
    await fastForward(w, PAUSE_BOOTH.resumeAt + 5)
    expect(linesShown(h, w.pausedAt!, h.clock.now()).map((l) => l.text), 'the lines on the lens since the swipe').toEqual(['paused', 'listening'])
    // The held pages: Marcus alone, and nothing promised (neither the wearer's "I'll email you the specs" nor Sam's brochure).
    await untilDot(w)
    const promises = await tapToPromises(w, ['Marcus'])
    expect(promisesOn(promises), 'the promises page').toEqual([])
    // The store, read directly: what was said before the pause is there, nothing said during it is (D76's transcript, the saved names).
    expect(inStore(h, ['lidar']), 'the transcript holds what was heard').toEqual(['lidar'])
    expect(inStore(h, PAUSE_BOOTH.words), 'words said while paused, in the store').toEqual([])
    // The jogger: the conversation ends, and the one written from it holds none of it either.
    const lastSaid = run.fixture.words.at(-1)!
    await fastForward(w, lastSaid.end + 2)
    await run.delivered()
    await longPressNow(w)
    await keptWithin(w, 30_000)
    const jogger = await openKept(w)
    const text = jogger.bullets.map((b) => b.text).join('\n')
    for (const word of PAUSE_BOOTH.words) expect(text, `"${word}", said while paused, is in the jogger`).not.toMatch(new RegExp(word, 'i'))
    expect(jogger.bullets.flatMap((b) => b.bold), 'the jogger is the conversation heard, its terms in bold').toEqual(expect.arrayContaining(['lidar', 'SLAM']))
  })

  // D86: the second swipe down, from a pause taken mid-talk with Dev.
  reg.define(/^Catch is paused and the lens shows the dim dash$/, async (w) => {
    const h = await beginPaused(w)
    await startRun(w, 'pause-resume.wearer-louder', PAUSE_RESUME.pauseAt)
    const dash = await pauseNow(w)
    await fastForward(w, PAUSE_RESUME.resumeAt)
    expectPausedThrough(w, dash.at, h.clock.now())
    expectDash(screenAt(h, h.clock.now()), w.dotBox, 'before the second swipe down')
  })

  reg.define(/^the wearer then sees the dot$/, async (w) => {
    const h = w.h!
    expectDotOnly(screenAt(h, w.lineAt!), 'once `listening` has gone')
    expect(w.dotBox && visible(screenAt(h, w.lineAt!)!)[0]!.box, 'the dot back in its place').toEqual(w.dotBox)
    // Listening again, on the far side: the microphone open, the frames reaching the server, and what is said heard.
    const mic = micCalls(h, w.resumedAt!)
    expect(mic.map((c) => c.data.isOpen), 'the lens opened the microphone again at the resume').toEqual([true])
    expect(mic[0]!.at - w.resumedAt!, 'at the swipe').toBeLessThanOrEqual(SLACK_MS)
    await fastForward(w, w.run!.fixture.words.at(-1)!.end + 0.5)
    await w.run!.delivered()
    expect(frameLog.some((at) => at > w.resumedAt! + SLACK_MS), 'no frame reached the server after the resume').toBe(true)
    expect(inStore(h, PAUSE_RESUME.heard), 'what the wearer and Dev say after the resume, in the transcript').toEqual(PAUSE_RESUME.heard)
    expect(inStore(h, PAUSE_RESUME.unheard), 'what was said while paused, in the store').toEqual([])
    for (const s of screensDuring(h, w.lineAt!, h.clock.now())) expectDotOnly(s, 'after the resume')
  })

  // D81: the pause freezes the conversation and its quiet.
  reg.define(/^the wearer is mid-conversation with Priya's name and one promise held$/, async (w) => {
    const h = await beginPaused(w)
    const run = await startRun(w, 'pause-freeze.wearer-louder', 0)
    const promise = lineIn(run, "Dev, I'll send you the deck.")
    expect(promise.words.every((wd) => wd.role === 'wearer'), 'the wearer promises').toBe(true)
    await playTo(w, promise.end + PROMISE_DONE_S)
    const shown = linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text)
    expect(shown[0], "Priya's name, seen on the lens").toBe('Priya')
    const promised = shown.filter((l) => l.startsWith('promised · ')).map((l) => l.slice('promised · '.length))
    expect(promised, 'one promise, seen on the lens').toHaveLength(1)
    w.promised = promised
    w.quietFrom = run.at(promise.end)
  })

  reg.define(/^the wearer has been silent for four minutes of the ten-minute quiet$/, async (w) => {
    const h = w.h!
    const run = w.run!
    await fastForward(w, PAUSE_FREEZE.pauseAt)
    expect(run.fixture.words.filter((wd) => wd.role === 'wearer' && wd.start > run.seconds(w.quietFrom!) && wd.start < PAUSE_FREEZE.pauseAt), 'the wearer said nothing').toEqual([])
    expect(Math.abs(h.clock.now() - w.quietFrom! - QUIET_BEFORE_MS), 'four minutes of silence').toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(screenAt(h, h.clock.now()), 'four minutes into the quiet')
    expect(h.notifications.received, 'the conversation is still open: nothing has gone to the phone').toEqual([])
  })

  reg.define(/^the wearer swipes down, stays paused for twelve minutes, and swipes down again$/, async (w) => {
    const h = w.h!
    const run = w.run!
    const dash = await pauseNow(w)
    // Twelve minutes: past the ten-minute quiet's end, had it run on (D81).
    await fastForward(w, run.seconds(w.pausedAt! + PAUSED_MS))
    expectPausedThrough(w, dash.at, h.clock.now())
    const said = run.fixture.words.filter((wd) => run.at(wd.start) > w.pausedAt! && run.at(wd.end) < h.clock.now())
    expect(said.some((wd) => wd.role === 'wearer'), 'the wearer speaks while paused').toBe(true)
    expect(said.some((wd) => wd.text === 'Sam.'), 'and someone introduces themselves').toBe(true)
    const back = await resumeNow(w)
    expectDotOnly(back, 'after the resume')
    expect((w.resumedAt! - w.pausedAt!) / 60_000, 'twelve minutes paused').toBeCloseTo(12, 1)
    // Nothing said while paused was heard: not in the store (the transcript, the saved names).
    expect(inStore(h, ['call', 'Sam', 'came', 'back again']), 'words said while paused, in the store').toEqual([])
  })

  reg.define(/^a tap shows Priya still held$/, async (w) => {
    await untilDot(w)
    expect(await tapForNames(w), 'the names page').toEqual(['Priya'])
    // The page goes with a tap (D34).
    const at = tap(w)
    await waitFor(w, () => (screens(w.h!).some((s) => s.at >= at && isDotOnly(s)) ? true : undefined))
  })

  reg.define(/^a tap and a swipe down show the promise still held$/, async (w) => {
    await untilDot(w)
    const page = await tapToPromises(w, ['Priya'])
    expect(promisesOn(page), 'the promises page').toEqual(w.promised)
    const at = tap(w)
    await waitFor(w, () => (screens(w.h!).some((s) => s.at >= at && isDotOnly(s)) ? true : undefined))
  })

  reg.define(/^the phone has received no notification$/, (w) => {
    expect(w.h!.notifications.received, 'the phone received something').toEqual([])
  })

  reg.define(/^the conversation ends only after six more minutes of the wearer's silence$/, async (w) => {
    const h = w.h!
    const run = w.run!
    const endsAt = w.resumedAt! + QUIET_AFTER_MS
    // Not before: just short of the six minutes, still open, its transcript in the store and nothing sent.
    await fastForward(w, run.seconds(endsAt - SLACK_MS))
    expect(run.fixture.words.filter((wd) => wd.role === 'wearer' && run.at(wd.start) > w.resumedAt!), 'the wearer said nothing after the resume').toEqual([])
    expect(h.notifications.received, 'the conversation ended before its six minutes were out').toEqual([])
    expect(rows(h.dbPath, 'transcript').length, "the open conversation's transcript").toBeGreaterThan(0)
    // Then it ends: its promise goes to the phone (D55), at the six minutes.
    await fastForward(w, run.seconds(endsAt + SLACK_MS))
    await waitFor(w, () => (h.notifications.phone(ACCOUNT).length > 0 ? true : undefined), SLACK_MS)
    const sent = h.notifications.phone(ACCOUNT)
    expect(sent, 'the conversation never ended: nothing reached the phone').toHaveLength(1)
    expect(Math.abs(sent[0]!.at - endsAt), `the conversation ended ${sent[0]!.at - endsAt} ms off six minutes after the resume`).toBeLessThanOrEqual(SLACK_MS)
    expect(linesOf(sent[0]!.notification).join(' '), 'its promise').toContain(w.promised![0]!.split(' ').at(-1)!)
    expect(rows(h.dbPath, 'transcript'), 'its transcript, deleted at the end (D76)').toEqual([])
  })
}

export default stayingDark
