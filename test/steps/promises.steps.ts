import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { loadFixture, type Fixture } from '../fixtures/fixture.ts'
import {
  begin,
  expectDotOnly,
  isLine,
  LINE_MS,
  lineIn,
  linesShown,
  playTo,
  screenAt,
  promisesOn,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  tapToPromises,
  untilDot,
  visible,
  type LensWorld,
} from './lens-world.ts'

// promises.feature (P2a): the wearer's own promises, D89, D90 and D47. Every
// "sees" is read from the bridge stub's record on fixture time (lens-world.ts),
// the promises page through a real tap and swipe down. The default split,
// loudness (D126), on the wearer-louder fixtures (D127);
// test/unit/promise-split.test.ts holds the same fixtures under every split
// on both variants. The model answers from cassettes written by hand
// (test/cassettes/by-hand.ts: no GEMINI_API_KEY was at hand).
//
// Bound: rows 2 and 4 of "A catch line appears and fades", D89's bare
// action, D90's bare yes, D47. Row 3 (Dev's promise), D91 and D113 are P5's:
// "Dev says" and the owed list are unbound, so the outline and those three
// scenarios stay scenario-scoped wip. Row 1 (Priya, after Dev's "come and
// meet Priya") is left unbound too: Dev's own words catch Priya by D18's
// "meet X", so her "Hi, I'm Priya" inside two minutes is "Priya (2)" by D88,
// not the row's "Priya" (a question for the operator).

const V = 'wearer-louder'

/** D89: a promise line within three seconds; D17: a name line within two. */
const BOUNDS: Record<string, number> = { '2 seconds': 2000, '3 seconds': 3000, 'three seconds': 3000 }

/** The P2a fixtures the promises scenarios are played on: Dev's opening, one line of Dev's, the wearer's answer (scripts.ts). */
const FIXTURES = ['promise-deck', 'promise-sam', 'promise-budget', 'think-about-it']

interface PromiseWorld extends LensWorld {
  /** What Dev has just said, as the step quotes it. */
  devSaid?: string
  /** The wearer's words, and the clock when they ended. */
  words?: string
  /** The promise line the lens showed. */
  line?: string
}

const norm = (t: string) => t.toLowerCase().replace(/[.,!?]/g, '').trim()

/** The fixture in which the wearer answers `words` (to Dev's `devSaid`, if given), Dev's name having been caught at its start. */
function fixtureFor(words: string, devSaid: string | undefined): string {
  const fits = (fx: Fixture) => {
    const i = fx.lines.findIndex((l) => l.who === 'wearer' && norm(l.text) === norm(words))
    if (i < 1) return false
    return devSaid === undefined || (fx.lines[i - 1]!.who === 'Dev' && norm(fx.lines[i - 1]!.text) === norm(devSaid))
  }
  const found = FIXTURES.map((n) => `${n}.${V}`).find((n) => fits(loadFixture(n)))
  expect(found, `no fixture has the wearer say "${words}"${devSaid ? ` after Dev's "${devSaid}"` : ''}`).toBeDefined()
  return found!
}

const promises: Definer<PromiseWorld> = (reg) => {
  // The Givens: the conversation with Dev, checked on the far side when the When starts the fixture.
  reg.define(/^the wearer is in a conversation with Dev, whose name was caught earlier, and the lens shows only the dot$/, async (w) => {
    await begin(w)
  })

  reg.define(/^the wearer is in a conversation with Dev and the lens shows only the dot$/, async (w) => {
    await begin(w)
  })

  reg.define(/^Dev has just said "([^"]+)"$/, (w, devArg) => {
    w.devSaid = String(devArg)
  })

  reg.define(/^Dev has just said "([^"]+)" and the lens shows only the dot$/, async (w, devArg) => {
    await begin(w)
    w.devSaid = String(devArg)
  })

  // Rows 2 and 4, D89, D90, D47. ("Priya says" and "Dev says" are unbound: see the header.)
  reg.define(/^the wearer says "([^"]+)"$/, async (w, wordsArg) => {
    const h = w.h!
    w.words = String(wordsArg)
    const run = await startRun(w, fixtureFor(w.words, w.devSaid), 0)
    const fx = run.fixture
    // Dev's name was caught at the start: the lens showed "Dev" and nothing else, then the dot.
    const dev = lineIn(run, "Hi, I'm Dev.")
    const answer = fx.lines.findIndex((l) => l.who === 'wearer' && norm(l.text) === norm(w.words!))
    const before = lineIn(run, fx.lines[answer - 1]!.text)
    await playTo(w, before.start)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'the names caught before').toEqual(['Dev'])
    // The lens shows only the dot as Dev says his line (or, with no line of Dev's quoted, as the wearer begins).
    expectDotOnly(screenAt(h, h.clock.now()), "before Dev's line")
    if (w.devSaid !== undefined) expect(before.words.every((wd) => wd.role === 'other'), 'Dev says it').toBe(true)
    expect(dev.end).toBeLessThan(before.start)
    // The wearer's words, said straight after.
    const said = lineIn(run, fx.lines[answer]!.text, before.end)
    expect(said.words.every((wd) => wd.role === 'wearer'), 'the wearer says it').toBe(true)
    await playTo(w, said.end)
    for (const s of screensDuring(h, run.at(before.start), h.clock.now())) expectDotOnly(s, "while Dev's line and the wearer's answer are said")
    w.saidAt = run.at(said.end)
  })

  reg.define(/^within (2 seconds|3 seconds|three seconds) the wearer sees "([^"]+)"(?: in dim text in the lower third of the lens)?$/, async (w, withinArg, lineArg) => {
    const h = w.h!
    const bound = BOUNDS[String(withinArg)]!
    const text = String(lineArg)
    await playTo(w, w.run!.seconds(w.saidAt!) + (bound + SLACK_MS) / 1000)
    const all = screens(h).filter((s) => s.at >= w.saidAt!)
    const line = all.find((s) => isLine(s, text))
    expect(line, `no dim lower-third "${text}" since the wearer spoke; screens: ${JSON.stringify(all.map((s) => visible(s).map((c) => c.content)))}`).toBeDefined()
    expect(line!.at - w.saidAt!, `"${text}" came ${line!.at - w.saidAt!} ms after the wearer's words`).toBeLessThanOrEqual(bound)
    // Until it came, the dot alone: no other line first.
    for (const s of screensDuring(h, w.saidAt!, line!.at - 1)) expectDotOnly(s, `before "${text}"`)
    w.lineAt = line!.at
    w.line = text
  })

  reg.define(/^the wearer sees the line fade after a second and a half$/, async (w) => {
    const h = w.h!
    await playTo(w, w.run!.seconds(w.lineAt!) + (LINE_MS + SLACK_MS) / 1000)
    const all = screens(h)
    const next = all[all.findIndex((s) => s.at === w.lineAt) + 1]
    expect(next, `"${w.line}" never left the lens`).toBeDefined()
    expect(Math.abs(next!.at - w.lineAt! - LINE_MS), `"${w.line}" stayed ${next!.at - w.lineAt!} ms`).toBeLessThanOrEqual(SLACK_MS)
    expect(isLine(next!, w.line!)).toBe(false)
  })

  reg.define(/^the wearer then sees only the dot$/, async (w) => {
    const h = w.h!
    const all = screens(h)
    const faded = all[all.findIndex((s) => s.at === w.lineAt) + 1]!
    // From the fade through the wearer's next words, which catch nothing: the dot alone.
    await playTo(w, w.run!.fixture.words.at(-1)!.end + (LINE_MS + SLACK_MS) / 1000)
    for (const s of screensDuring(h, faded.at, h.clock.now())) expectDotOnly(s, `after "${w.line}" faded`)
  })

  reg.define(/^the wearer sees no line on the lens$/, async (w) => {
    const h = w.h!
    // The promise bound and a line's whole stay, then the rest of the fixture: only ever the dot.
    await playTo(w, w.run!.fixture.words.at(-1)!.end + (3000 + LINE_MS + SLACK_MS) / 1000)
    for (const s of screensDuring(h, w.saidAt!, h.clock.now())) expectDotOnly(s, `after "${w.words}"`)
  })

  // D89, D90: the promise held; D47: nothing held under promises.
  reg.define(/^a tap and a swipe down show "([^"]+)" held for this conversation$/, async (w, heldArg) => {
    await untilDot(w)
    const page = await tapToPromises(w, ['Dev'])
    expect(promisesOn(page), 'the promises page').toEqual([String(heldArg)])
  })

  reg.define(/^a tap and a swipe down show nothing held under promises$/, async (w) => {
    await untilDot(w)
    const page = await tapToPromises(w, ['Dev'])
    expect(visible(page).map((c) => c.content), 'the promises page').toEqual(['this conversation 2/2', 'no promises yet'])
  })
}

export default promises
