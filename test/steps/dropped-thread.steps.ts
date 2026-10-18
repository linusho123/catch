import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { loadFixture, type Fixture, type FixtureWord } from '../fixtures/fixture.ts'
import type { FixtureRun } from '../harness/player.ts'
import {
  begin,
  expectDotOnly,
  fastForward,
  inLowerThird,
  isLine,
  isPage,
  LOWEST_READABLE,
  linesShown,
  namesOn,
  nowSec,
  playTo,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  tap,
  visible,
  waitFor,
  type LensWorld,
  type Screen,
} from './lens-world.ts'

// dropped-thread.feature (P3): D35, D48-D50, D33, D36, D34 and D120. Every
// "sees" is read from the bridge stub's record on fixture time
// (lens-world.ts); the thread's words are compared with the fixture's
// transcript (its words and roles), never with the server's notion of the
// run. The default split, loudness (D126), on the wearer-louder fixtures
// (D127); test/unit/thread-split.test.ts runs the same fixtures under
// every split on both variants.

const V = 'wearer-louder'

/** D35: someone else has taken the floor after two to three seconds of continuous speech. */
const FLOOR_FROM_MS = 2000
const FLOOR_BY_MS = 3000
/** The longest pause inside a stretch of speech these fixtures call continuous (their words sit 0.06 s apart). */
const CONTINUOUS_GAP_S = 0.3
/** Fixture seconds played, not skipped, after a jump across silence, so what the server pushed in the jump is delivered (a tenth of a second of wall time at 20x). */
const SETTLE_S = 2

/** The fixtures the outline's rows are found in: the row's words pick the one that says them. */
const OUTLINE_FIXTURES = ['dropped-thread', 'thread-continuous', 'thread-across-turn']

interface ThreadWorld extends LensWorld {
  /** The outline's "<before>" and "<run>", as the steps quote them. */
  before?: string
  runText?: string
  fixture?: string
  /** Fixture seconds: where the wearer's run (or sentence) ends, and where Dev (or Marcus) begins and stops. */
  runEnd?: number
  otherStart?: number
  /** The thread line as the lens showed it. */
  line?: Screen
  /** The clock from which the lens must show only the dot. */
  dotFrom?: number
  tappedAt?: number
}

const norm = (t: string) => t.toLowerCase().replace(/[.,!?]/g, '')
const tokens = (text: string) => text.split(/\s+/).filter(Boolean)

/** Who says each of a fixture's words: the script line it came from (make-fixtures.ts keeps them in order). */
function speakers(fx: Fixture): string[] {
  return fx.lines.flatMap((l) => tokens(l.text).map(() => l.who))
}

/** Where `text` is said in the fixture by `role` at or after word index `from`: the index of its first word, case and punctuation aside. */
function said(fx: Fixture, text: string, role: 'wearer' | 'other', from = 0): number | undefined {
  const want = tokens(text).map(norm)
  for (let i = from; i + want.length <= fx.words.length; i++) {
    const span = fx.words.slice(i, i + want.length)
    if (span.every((wd, j) => wd.role === role && norm(wd.text) === want[j])) return i
  }
  return undefined
}

/** A sentence left unfinished: its last word, as transcribed, ends with no full stop, question or exclamation mark. */
const unfinished = (wd: FixtureWord) => !/[.!?]$/.test(wd.text)

/**
 * Someone else's speech from word `i`: the stretch it keeps up without a
 * pause, and who says it. It must be one person, with no word of the wearer's in it.
 */
function stretch(fx: Fixture, i: number): { who: string; start: number; end: number } {
  const who = speakers(fx)
  const first = fx.words[i]!
  expect(first.role, `"${first.text}" at ${first.start}s is the wearer's`).toBe('other')
  let end = first.end
  for (let j = i + 1; j < fx.words.length && fx.words[j]!.role === 'other' && fx.words[j]!.start - end <= CONTINUOUS_GAP_S; j++) {
    expect(who[j], 'one person keeps speaking').toBe(who[i])
    end = fx.words[j]!.end
  }
  return { who: who[i]!, start: first.start, end }
}

/** The wearer's run as the transcript has it: their words up to and including word `last`, back to anyone else's latest word. */
function wearerRun(fx: Fixture, last: number): FixtureWord[] {
  let first = last
  while (first > 0 && fx.words[first - 1]!.role === 'wearer') first--
  return fx.words.slice(first, last + 1)
}

/** The line's words (after its ellipsis) are the end of the wearer's run in the transcript: never across someone else's turn (D48). */
function expectEndOfRun(fx: Fixture, last: number, line: string): void {
  expect(line.startsWith('…'), `"${line}" opens with an ellipsis`).toBe(true)
  const shown = tokens(line.slice(1))
  const run = wearerRun(fx, last).map((wd) => wd.text)
  expect(shown.length).toBeGreaterThan(0)
  expect(run.slice(-shown.length), `"${line}" is the end of the wearer's run "${run.join(' ')}"`).toEqual(shown)
}

/** The first dropped-thread line on the lens since `from`: one dim line in the lower third opening with an ellipsis. */
function threadLineSince(w: ThreadWorld, from: number): Screen | undefined {
  return screens(w.h!).find((s) => {
    const seen = visible(s)
    return s.at >= from && seen.length === 1 && seen[0]!.content.startsWith('…') && inLowerThird(seen[0]!.box) && seen[0]!.brightness === LOWEST_READABLE
  })
}

/** Every screen from `from` to now shows the dot and nothing else. */
function expectOnlyDotSince(w: ThreadWorld, from: number, when: string): void {
  const h = w.h!
  const during = screensDuring(h, from, h.clock.now())
  expect(during.length, `no screen ${when}`).toBeGreaterThan(0)
  for (const s of during) expectDotOnly(s, when)
  expectDotOnly(screenAt(h, h.clock.now()), 'now')
}

/** Starts `fixture`, finds the wearer saying `text` and stopping mid-sentence, and someone else taking the floor right after. */
async function cutOff(w: ThreadWorld, fixture: string, text: string): Promise<{ run: FixtureRun; last: number }> {
  const run = await startRun(w, fixture, 0)
  const fx = run.fixture
  const i = said(fx, text, 'wearer')
  expect(i, `${fixture}: the wearer never says "${text}"`).toBeDefined()
  const last = i! + tokens(text).length - 1
  expect(unfinished(fx.words[last]!), `"${fx.words[last]!.text}" ends the sentence`).toBe(true)
  const next = fx.words[last + 1]
  expect(next?.role, `${fixture}: nobody speaks after "${text}"`).toBe('other')
  const dev = stretch(fx, last + 1)
  expect(dev.who).toBe('Dev')
  expect(dev.end - dev.start, `Dev speaks for ${dev.end - dev.start} s`).toBeGreaterThanOrEqual(FLOOR_BY_MS / 1000)
  w.fixture = fixture
  w.runEnd = fx.words[last]!.end
  w.otherStart = dev.start
  await playTo(w, w.runEnd)
  return { run, last }
}

const droppedThread: Definer<ThreadWorld> = (reg) => {
  // D35, D48, D49, D50
  reg.define(/^earlier in the conversation the wearer said "([^"]+)"$/, async (w, beforeArg) => {
    await begin(w)
    w.before = String(beforeArg)
  })

  reg.define(/^the wearer then says "([^"]+)" and stops mid-sentence$/, (w, runArg) => {
    w.runText = String(runArg)
    const m = /^(.*?)(?:, (with nobody speaking in between)|, after which Dev said (.+))?$/.exec(w.before!)!
    const [, earlier, nobody, between] = m
    // The row's words pick the fixture that says them, in that order, and the transcript is checked to say exactly that.
    const fits = (fx: Fixture) => {
      const r = said(fx, w.runText!, 'wearer')
      if (r === undefined || r === 0) return false
      if (earlier === 'nothing of note') {
        // Whatever the wearer said earlier, someone else spoke after it: none of it is part of the run.
        return fx.words.slice(0, r).some((wd) => wd.role === 'wearer') && fx.words[r - 1]!.role === 'other'
      }
      const e = said(fx, earlier!, 'wearer')
      if (e === undefined) return false
      const gap = fx.words.slice(e + tokens(earlier!).length, r)
      if (nobody) return gap.length === 0
      return gap.length === tokens(between!).length && said(fx, between!, 'other', e) === e + tokens(earlier!).length
    }
    const found = OUTLINE_FIXTURES.map((name) => `${name}.${V}`).find((name) => fits(loadFixture(name)))
    expect(found, `no fixture has the wearer say "${w.before}" and then "${w.runText}"`).toBeDefined()
    w.fixture = found
  })

  reg.define(/^Dev begins speaking and keeps speaking for three seconds$/, async (w) => {
    await cutOff(w, w.fixture!, w.runText!)
    await playTo(w, w.otherStart! + FLOOR_BY_MS / 1000 + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees "([^"]+)" in dim text in the lower third of the lens$/, (w, lensArg) => {
    const h = w.h!
    const run = w.run!
    const text = String(lensArg)
    const all = screens(h).filter((s) => s.at >= run.at(w.runEnd!))
    const line = all.find((s) => isLine(s, text))
    expect(line, `no dim lower-third "${text}"; screens since the wearer stopped: ${JSON.stringify(all.map((s) => visible(s).map((c) => c.content)))}`).toBeDefined()
    // Once Dev has spoken for two to three seconds, and not before (D35); until then only the dot.
    const after = line!.at - run.at(w.otherStart!)
    expect(after, `the line came ${after} ms after Dev began`).toBeGreaterThanOrEqual(FLOOR_FROM_MS)
    expect(after, `the line came ${after} ms after Dev began`).toBeLessThanOrEqual(FLOOR_BY_MS + SLACK_MS)
    for (const s of screensDuring(h, run.at(w.runEnd!), line!.at - 1)) expectDotOnly(s, 'before Dev has taken the floor')
    // The words are the end of the wearer's run in the fixture's transcript.
    const last = said(run.fixture, w.runText!, 'wearer')! + tokens(w.runText!).length - 1
    expectEndOfRun(run.fixture, last, text)
    w.line = line
  })

  reg.define(/^the wearer still sees it until the wearer speaks again$/, async (w) => {
    const h = w.h!
    const run = w.run!
    const fx = run.fixture
    const resume = fx.words.find((wd) => wd.role === 'wearer' && wd.start > w.runEnd!)!
    expect(resume, 'the wearer never speaks again').toBeDefined()
    // Dev's whole turn, and the silence after it, before the wearer speaks.
    expect(resume.start - w.otherStart!, 'the wearer is quiet a long while').toBeGreaterThanOrEqual(15)
    await fastForward(w, resume.end)
    await playTo(w, resume.end + SLACK_MS / 1000)
    const text = visible(w.line!)[0]!.content
    for (const s of screensDuring(h, w.line!.at, run.at(resume.end) - 1)) {
      expect(isLine(s, text), `at ${run.seconds(s.at)} s, before the wearer spoke, the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
    }
    // ... and it goes when the wearer speaks.
    const all = screens(h)
    const next = all[all.findIndex((s) => s.at === w.line!.at) + 1]
    expect(next, 'the line never went').toBeDefined()
    expect(next!.at - run.at(resume.end), `the line went ${next!.at - run.at(resume.end)} ms after "${resume.text}"`).toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(next, 'once the wearer speaks')
  })

  // D33
  reg.define(/^the wearer finishes the complete sentence "([^"]+)"$/, async (w, sentenceArg) => {
    await begin(w)
    w.runText = String(sentenceArg)
    w.fixture = `normal-turn.${V}`
  })

  reg.define(/^Marcus starts talking a second and a half later and the wearer stays quiet while he talks$/, async (w) => {
    const run = await startRun(w, w.fixture!, 0)
    const fx = run.fixture
    const i = said(fx, w.runText!, 'wearer')
    expect(i, `the wearer never says "${w.runText}"`).toBeDefined()
    const last = i! + tokens(w.runText!).length - 1
    expect(unfinished(fx.words[last]!), `"${fx.words[last]!.text}": the sentence is finished`).toBe(false)
    const marcus = stretch(fx, last + 1)
    expect(marcus.who).toBe('Marcus')
    expect(marcus.start - fx.words[last]!.end, 'Marcus starts a second and a half later').toBeCloseTo(1.5, 3)
    // Long enough that, after an unfinished sentence, it would be taking the floor (D35).
    expect(marcus.end - marcus.start).toBeGreaterThanOrEqual(FLOOR_BY_MS / 1000)
    const next = fx.words.find((wd) => wd.start > fx.words[last]!.end && wd.role === 'wearer')
    expect(next === undefined || next.start > marcus.end, 'the wearer stays quiet while Marcus talks').toBe(true)
    await playTo(w, marcus.end + 1)
    w.dotFrom = w.dotSince
  })

  reg.define(/^the wearer sees only the dot$/, (w) => {
    expectOnlyDotSince(w, w.dotFrom!, 'in the moment the scenario is about')
  })

  // D36
  reg.define(/^the wearer stops mid-sentence at "([^"]+)" to find a word$/, async (w, stopArg) => {
    await begin(w)
    w.runText = String(stopArg)
    w.fixture = `thinking-pause.${V}`
  })

  reg.define(/^three seconds pass with nobody else speaking$/, async (w) => {
    const run = await startRun(w, w.fixture!, 0)
    const fx = run.fixture
    const i = said(fx, w.runText!, 'wearer')
    expect(i, `the wearer never says "${w.runText}"`).toBeDefined()
    const last = i! + tokens(w.runText!).length - 1
    expect(unfinished(fx.words[last]!)).toBe(true)
    w.runEnd = fx.words[last]!.end
    expect(fx.words[last + 1]!.start - w.runEnd, 'three seconds with nobody speaking').toBeGreaterThan(3)
    await playTo(w, w.runEnd + 3)
    w.dotFrom = w.dotSince
  })

  reg.define(/^the wearer still sees only the dot however long the silence lasts$/, async (w) => {
    const fx = w.run!.fixture
    const resume = fx.words.find((wd) => wd.start > w.runEnd!)!
    expect(resume.role, 'nobody else speaks in the silence').toBe('wearer')
    expect(resume.start - w.runEnd!, 'a long silence').toBeGreaterThanOrEqual(60)
    // Across the whole silence, up to the moment the wearer goes on. The jump
    // fires the server's timers at once; the silence's last seconds are played
    // on the clock, so anything those timers pushed has reached the bridge
    // before the record is read (head-2).
    await fastForward(w, resume.start - SETTLE_S)
    await playTo(w, resume.start)
    expectOnlyDotSince(w, w.dotSince!, 'through the silence')
  })

  // D35: the line clears when the wearer resumes.
  reg.define(/^the line "([^"]+)" is showing on the lens$/, async (w, lineArg) => {
    await begin(w)
    const text = String(lineArg)
    const { run, last } = await cutOff(w, `dropped-thread.${V}`, tokens(text.slice(1)).join(' '))
    w.line = await waitFor(w, () => threadLineSince(w, run.at(w.runEnd!)), FLOOR_BY_MS + 1000)
    expect(w.line && isLine(w.line, text), `"${text}" never came up`).toBe(true)
    expectEndOfRun(run.fixture, last, text)
    expectDotOnly(screensDuring(w.h!, run.at(w.runEnd!), w.line!.at - 1).at(-1), 'before the line')
  })

  reg.define(/^the wearer says "([^"]+)"$/, async (w, saysArg) => {
    const run = w.run!
    const fx = run.fixture
    const since = fx.words.findIndex((wd) => run.at(wd.start) > w.line!.at)
    expect(since, 'nothing is said after the line came up').toBeGreaterThanOrEqual(0)
    const i = said(fx, String(saysArg), 'wearer', since)
    expect(i, `the wearer never says "${saysArg}" after the line came up`).toBeDefined()
    // The first thing the wearer says since the line came up.
    expect(fx.words.slice(0, i).filter((wd) => wd.role === 'wearer' && run.at(wd.start) > w.line!.at)).toEqual([])
    const end = fx.words[i! + tokens(String(saysArg)).length - 1]!.end
    await fastForward(w, end)
    await playTo(w, end + SLACK_MS / 1000)
    // By the time the wearer has said it, the line is gone (how soon it goes is the outline's to check).
    w.dotFrom = run.at(end) + SLACK_MS
  })

  // D34
  reg.define(/^a dropped-thread line is showing on the lens$/, async (w) => {
    await begin(w)
    const { run, last } = await cutOff(w, `dropped-thread.${V}`, 'and the second reason is')
    w.line = await waitFor(w, () => threadLineSince(w, run.at(w.runEnd!)), FLOOR_BY_MS + 1000)
    expect(w.line, 'no dropped-thread line came up').toBeDefined()
    expectEndOfRun(run.fixture, last, visible(w.line!)[0]!.content)
  })

  reg.define(/^the wearer taps the glasses$/, async (w) => {
    w.tappedAt = tap(w)
    // Dev is still talking: three more seconds of it, in which nothing may come back.
    await playTo(w, nowSec(w) + 3)
    w.dotFrom = w.tappedAt + SLACK_MS
  })

  reg.define(/^the wearer does not see the held page$/, (w) => {
    const during = screensDuring(w.h!, w.tappedAt!, w.h!.clock.now())
    for (const s of during) expect(isPage(s), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(false)
  })

  // D120
  reg.define(/^automatic cut-off detection is switched off$/, async (w) => {
    const h = await begin(w)
    // The operator's switch (CATCH_THREAD_DETECTION=off), set on the running server.
    h.server.setThreadDetection(false)
  })

  reg.define(/^the wearer said "([^"]+)" and stopped mid-sentence, and Dev has taken the floor$/, async (w, saidArg) => {
    await cutOff(w, `dropped-thread.${V}`, String(saidArg))
    await playTo(w, w.otherStart! + FLOOR_BY_MS / 1000 + SLACK_MS / 1000)
  })

  reg.define(/^the lens shows only the dot$/, (w) => {
    // From the moment the wearer stopped, through Dev's taking the floor: no thread line came on its own.
    expectOnlyDotSince(w, w.run!.at(w.runEnd!), 'while Dev has the floor')
  })

  reg.define(/^the wearer sees the held page with "([^"]+)" as its first line, above the names$/, (w, threadArg) => {
    const h = w.h!
    const page = screens(h).find((s) => s.at >= w.tappedAt! && isPage(s))
    expect(page, `a tap brought up no page; screens since: ${JSON.stringify(screens(h).filter((s) => s.at >= w.tappedAt!).map((s) => visible(s).map((c) => c.content)))}`).toBeDefined()
    expect(page!.at - w.tappedAt!, 'the page comes on the tap').toBeLessThanOrEqual(SLACK_MS)
    const parts = [...visible(page!)].sort((a, b) => a.box.y - b.box.y)
    for (const c of parts) expect(c.brightness, `the page's ${c.containerName} is dim`).toBe(LOWEST_READABLE)
    // Its first line, at the top of the page.
    expect(parts[0]!.content).toBe(String(threadArg))
    expect(parts.filter((c) => c.content === String(threadArg)), 'the thread is shown once').toHaveLength(1)
    // Above the names, which are the names this conversation caught.
    const names = parts.find((c) => c.containerName === 'names')
    expect(names, 'the page lists no names').toBeDefined()
    expect(parts[0]!.box.y + parts[0]!.box.height, 'the thread sits above the names').toBeLessThanOrEqual(names!.box.y)
    const caught = linesShown(h, w.dotSince!, w.run!.at(w.runEnd!)).map((l) => l.text)
    expect(caught, 'the conversation caught a name before the wearer was cut off').toEqual(['Priya'])
    expect(namesOn(page!)).toEqual(caught)
  })
}

export default droppedThread
