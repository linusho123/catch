import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { findIntroductions } from '../../server/src/catch/introductions.ts'
import { loadFixture, type Fixture } from '../fixtures/fixture.ts'
import {
  begin,
  NAME_BOUND_MS,
  nowSec,
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
  namesOn,
  swipeDown,
  tap,
  tapForPage,
  tapToPromises,
  untilDot,
  waitFor,
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
// Bound: every scenario. Rows 1, 2 and 4 of "A catch line appears and fades",
// D89's bare action, D90's bare yes, D47 (P2a). Row 1 (Priya, after Dev's
// "come and meet Priya") is D132's: Dev's own words name Priya by D18's "meet
// X", her name's line comes and goes, and her own "Hi, I'm Priya" is the same
// person, shown as "Priya", never "Priya (2)".
//
// P5, the promises owed to the wearer: row 3 and D91 (Dev, caught at the
// start, promises; the lens line is "Dev promised · …", and the promises page
// lists it after the wearer's own as "owed: Dev sends …", the pronoun turned:
// never "send Dev …"), and D113's three (nobody named: "they promised · …"
// and "owed: they (1) …"; the name caught next attaches to the most recent
// promiser only). Every owed line is read from the lens's payloads; the
// promiser's words are checked to be another person's in the fixture, and,
// in the D113 scenarios, the person who later gives the name is checked to be
// the one who promised. test/integration/owed-split.test.ts holds the same
// fixtures under every split on both variants.

const V = 'wearer-louder'

/** D89: a promise line within three seconds; D17: a name line within two. */
const BOUNDS: Record<string, number> = { '2 seconds': 2000, '3 seconds': 3000, 'three seconds': 3000 }

/** The P2a fixtures the promises scenarios are played on: Dev's opening, one line of Dev's, the wearer's answer (scripts.ts). */
const FIXTURES = ['promise-deck', 'promise-sam', 'promise-budget', 'think-about-it', 'meet-priya', 'owed-deck', 'owed-agenda']

/** D89: a promise line within three seconds, and the second and a half it stays. */
const PROMISE_DONE_S = (3000 + LINE_MS + SLACK_MS) / 1000

interface PromiseWorld extends LensWorld {
  /** What Dev has just said, as the step quotes it. */
  devSaid?: string
  /** D91's Given: the wearer's own promise, said before Dev's, as the lens summarizes it. */
  promisedBefore?: string
  /** D113's Givens: nobody has been named; who (in the fixture's script) made each owed promise, in order. */
  nobodyNamed?: boolean
  promisers?: string[]
  /** The wearer's words, and the clock when they ended. */
  words?: string
  /** The promise line the lens showed. */
  line?: string
}

const norm = (t: string) => t.toLowerCase().replace(/[.,!?]/g, '').trim()

/** The names caught on the lens since the scenario's fixture began: the lens's lines that are no promise line. */
const namesCaught = (w: LensWorld) =>
  linesShown(w.h!, w.dotSince!, w.h!.clock.now())
    .map((l) => l.text)
    .filter((t) => !t.includes('promised · '))

/** Nobody introduces themselves in the fixture before fixture second `until`. */
function expectNobodyNamedBefore(w: LensWorld, until: number): void {
  const said = w.run!.fixture.words.filter((wd) => wd.end <= until && wd.role === 'other')
  expect(findIntroductions(said.map((wd) => wd.text)), 'someone introduced themselves').toEqual([])
  expect(namesCaught(w), 'a name was caught').toEqual([])
}

/** The fixture line (its script entry and its words) reading `text`, at or after fixture second `after`. */
function scriptLine(w: LensWorld, text: string, after = 0) {
  const fx = w.run!.fixture
  const said = lineIn(w.run!, text, after)
  const line = fx.lines.find((l) => norm(l.text) === norm(text) && said.words[0]!.start >= after)
  expect(line, `no script line "${text}"`).toBeDefined()
  return { ...said, who: line!.who }
}

/**
 * A tap and a swipe down: the names page lists the names the lens caught, and
 * the promises page what it held. Something is held, so the tap shows the
 * names page, its header and its hint to the promises, even with no name on
 * it, never D31's `this conversation · nothing held`.
 */
async function heldPromises(w: LensWorld): Promise<string[]> {
  await untilDot(w)
  const names = await tapForPage(w)
  expect(namesOn(names), 'the names page lists the names caught').toEqual(namesCaught(w))
  const parts = Object.fromEntries(visible(names).map((c) => [c.containerName, c.content]))
  expect(parts, 'the names page, with something held').toMatchObject({ header: 'this conversation 1/2', hint: '↓ promises' })
  expect(parts.empty, "D31's nothing-held page, with promises held").toBeUndefined()
  return promisesOn(await swipeDown(w))
}

/** The fixture in which `who` (the wearer by default) answers `words` (to Dev's `devSaid`, if given), Dev's name having been caught at its start. */
function fixtureFor(words: string, devSaid: string | undefined, who = 'wearer'): string {
  const fits = (fx: Fixture) => {
    const i = fx.lines.findIndex((l) => l.who === who && norm(l.text) === norm(words))
    if (i < 1) return false
    return devSaid === undefined || (fx.lines[i - 1]!.who === 'Dev' && norm(fx.lines[i - 1]!.text) === norm(devSaid))
  }
  const found = FIXTURES.map((n) => `${n}.${V}`).find((n) => fits(loadFixture(n)))
  expect(found, `no fixture has ${who} say "${words}"${devSaid ? ` after Dev's "${devSaid}"` : ''}`).toBeDefined()
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

  // Row 1, D132: Priya introduces herself after Dev's "meet Priya" named her.
  reg.define(/^Priya says "([^"]+)"$/, async (w, wordsArg) => {
    const h = w.h!
    w.words = String(wordsArg)
    const run = await startRun(w, fixtureFor(w.words, w.devSaid, 'Priya'), 0)
    const fx = run.fixture
    lineIn(run, "Hi, I'm Dev.")
    const answer = fx.lines.findIndex((l) => l.who === 'Priya' && norm(l.text) === norm(w.words!))
    const before = lineIn(run, fx.lines[answer - 1]!.text)
    await playTo(w, before.start)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'the names caught before').toEqual(['Dev'])
    expectDotOnly(screenAt(h, h.clock.now()), "before Dev's line")
    expect(before.words.every((wd) => wd.role === 'other'), 'Dev says it').toBe(true)
    const said = lineIn(run, fx.lines[answer]!.text, before.end)
    expect(said.words.every((wd) => wd.role === 'other'), 'Priya, not the wearer, says it').toBe(true)
    // Dev's "meet Priya" named her first (D18): her name's line came and went before she spoke, so hers is the second hearing.
    await playTo(w, said.start)
    expect(linesShown(h, run.at(before.start), h.clock.now()).map((l) => l.text), `Dev's "${w.devSaid}" names Priya`).toEqual(['Priya'])
    expectDotOnly(screenAt(h, h.clock.now()), 'as Priya begins')
    await playTo(w, said.end)
    w.saidAt = run.at(said.end)
  })

  // P5, row 3 and D91: Dev, caught at the start, promises something. (The When checks the far side as it plays.)
  reg.define(/^the wearer is in a conversation with Dev, whose name was caught earlier$/, async (w) => {
    await begin(w)
  })

  reg.define(/^the wearer has promised to send Dev the deck tonight$/, (w) => {
    w.promisedBefore = 'send Dev the deck tonight'
  })

  reg.define(/^Dev says "([^"]+)"$/, async (w, wordsArg) => {
    const h = w.h!
    w.words = String(wordsArg)
    const run = await startRun(w, fixtureFor(w.words, w.devSaid, 'Dev'), 0)
    const fx = run.fixture
    // Dev's name was caught at the start, by his own introduction: the lens showed "Dev", then the dot.
    const dev = lineIn(run, "Hi, I'm Dev.")
    expect(dev.words.every((wd) => wd.role === 'other'), 'Dev introduces himself').toBe(true)
    const answer = fx.lines.findIndex((l) => l.who === 'Dev' && norm(l.text) === norm(w.words!))
    const before = lineIn(run, fx.lines[answer - 1]!.text, dev.end)
    await playTo(w, before.start)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'the names caught before').toEqual(['Dev'])
    expectDotOnly(screenAt(h, h.clock.now()), "before Dev's line")
    if (w.devSaid !== undefined) expect([fx.lines[answer - 1]!.who, norm(fx.lines[answer - 1]!.text)], 'Dev has just said it').toEqual(['Dev', norm(w.devSaid)])
    const said = lineIn(run, fx.lines[answer]!.text, before.end)
    expect(said.words.every((wd) => wd.role === 'other'), 'Dev, not the wearer, says it').toBe(true)
    await playTo(w, said.start)
    if (w.promisedBefore !== undefined) {
      // D91's Given, on the far side: the wearer's promise came and went before Dev spoke.
      expect(before.words.every((wd) => wd.role === 'wearer'), "the wearer's promise").toBe(true)
      expect(linesShown(h, run.at(before.start), h.clock.now()).map((l) => l.text), 'the wearer promised first').toEqual([`promised · ${w.promisedBefore}`])
    }
    expectDotOnly(screenAt(h, h.clock.now()), 'as Dev begins')
    await playTo(w, said.end)
    for (const s of screensDuring(h, run.at(said.start), h.clock.now())) expectDotOnly(s, 'while Dev says it')
    w.saidAt = run.at(said.end)
  })

  reg.define(/^within three seconds the wearer sees "([^"]+)" in dim text for a second and a half$/, async (w, lineArg) => {
    const h = w.h!
    const text = String(lineArg)
    await playTo(w, w.run!.seconds(w.saidAt!) + PROMISE_DONE_S + SLACK_MS / 1000)
    const all = screens(h)
    const i = all.findIndex((s) => s.at >= w.saidAt! && isLine(s, text))
    expect(i, `no dim lower-third "${text}" since it was said; screens: ${JSON.stringify(all.filter((s) => s.at >= w.saidAt!).map((s) => visible(s).map((c) => c.content)))}`).toBeGreaterThanOrEqual(0)
    const line = all[i]!
    expect(line.at - w.saidAt!, `"${text}" came ${line.at - w.saidAt!} ms after the words`).toBeLessThanOrEqual(3000)
    for (const s of screensDuring(h, w.saidAt!, line.at - 1)) expectDotOnly(s, `before "${text}"`)
    const next = all[i + 1]
    expect(next, `"${text}" never left the lens`).toBeDefined()
    expect(Math.abs(next!.at - line.at - LINE_MS), `"${text}" stayed ${next!.at - line.at} ms`).toBeLessThanOrEqual(SLACK_MS)
    expectDotOnly(next, `after "${text}"`)
    w.lineAt = line.at
    w.line = text
  })

  reg.define(/^a tap and a swipe down show "([^"]+)" first and "([^"]+)" after it$/, async (w, firstArg, afterArg) => {
    expect(await heldPromises(w), 'the promises page').toEqual([String(firstArg), String(afterArg)])
  })

  // P5, D26 and D113: promises from people nobody has named.
  reg.define(/^the wearer is in a conversation in which nobody has introduced themselves$/, async (w) => {
    await begin(w)
    w.nobodyNamed = true
  })

  reg.define(/^another person says "([^"]+)"$/, async (w, wordsArg) => {
    const h = w.h!
    w.words = String(wordsArg)
    const run = await startRun(w, `owed-unnamed.${V}`, 0)
    const said = scriptLine(w, `${w.words}.`)
    expect(said.words.every((wd) => wd.role === 'other'), 'another person, not the wearer, says it').toBe(true)
    // The conversation is under way: the wearer has spoken, and nobody has been named.
    expect(run.fixture.words.some((wd) => wd.role === 'wearer' && wd.end < said.start), 'the wearer has spoken').toBe(true)
    await playTo(w, said.start)
    if (w.nobodyNamed) expectNobodyNamedBefore(w, said.start)
    expectDotOnly(screenAt(h, h.clock.now()), 'as they begin')
    await playTo(w, said.end)
    w.saidAt = run.at(said.end)
    w.promisers = [said.who]
  })

  reg.define(/^the owed list holds "([^"]+)"$/, async (w, heldArg) => {
    const h = await begin(w)
    const run = await startRun(w, `owed-unnamed.${V}`, 0)
    const promise = scriptLine(w, "I'll send you the deck tonight.")
    expect(promise.words.every((wd) => wd.role === 'other'), 'another person promised it').toBe(true)
    await playTo(w, promise.end + PROMISE_DONE_S)
    expectNobodyNamedBefore(w, promise.end)
    // On the far side: the promises page holds it, and nothing else.
    expect(await heldPromises(w), 'the owed list').toEqual([`owed: ${String(heldArg)}`])
    // The page goes on a tap, back to the dot.
    const at = tap(w)
    await waitFor(w, () => (screens(h).some((s) => s.at >= at && visible(s).length === 1 && visible(s)[0]!.content === '•') ? true : undefined))
    expectDotOnly(screenAt(h, h.clock.now()), 'after the page')
    expect(nowSec(w), 'the Given is over before the name is said').toBeLessThan(lineIn(run, "By the way, I'm Dev.").start)
    w.promisers = [promise.who]
  })

  reg.define(/^nobody has introduced themselves, one person has said "([^"]+)", and a second person has said "([^"]+)"$/, async (w, firstArg, secondArg) => {
    const h = await begin(w)
    const run = await startRun(w, `owed-two.${V}`, 0)
    const first = scriptLine(w, `${String(firstArg)}.`)
    const second = scriptLine(w, `${String(secondArg)}.`, first.end)
    for (const line of [first, second]) expect(line.words.every((wd) => wd.role === 'other'), 'another person says it').toBe(true)
    expect(first.who, 'two people, not one').not.toBe(second.who)
    await playTo(w, second.end + PROMISE_DONE_S)
    expectNobodyNamedBefore(w, second.end)
    // D113: the lens showed each as theirs, in the order said.
    const lines = linesShown(h, w.dotSince!, h.clock.now())
    expect(lines.map((l) => l.text), 'the lens lines').toEqual(['they promised · send the deck tonight', 'they promised · send the slides'])
    expect(lines[0]!.at - run.at(first.end)).toBeLessThanOrEqual(3000)
    expect(lines[1]!.at - run.at(second.end)).toBeLessThanOrEqual(3000)
    w.promisers = [first.who, second.who]
  })

  reg.define(/^(that|the second) person says "([^"]+)"$/, async (w, whichArg, wordsArg) => {
    const h = w.h!
    const said = scriptLine(w, `${String(wordsArg)}`.replace(/([^.!?])$/, '$1.'), nowSec(w))
    const promiser = String(whichArg) === 'that' ? w.promisers![0] : w.promisers![1]
    expect(said.who, 'the one who promised says it').toBe(promiser)
    expect(said.words.every((wd) => wd.role === 'other'), 'another person, not the wearer, says it').toBe(true)
    await playTo(w, said.end + (NAME_BOUND_MS + SLACK_MS) / 1000)
    // The name is caught, on the far side: its line on the lens within two seconds.
    const name = linesShown(h, w.run!.at(said.start), h.clock.now())
    expect(name.map((l) => l.text), 'the name caught').toEqual(['Dev'])
    expect(name[0]!.at - w.run!.at(said.end)).toBeLessThanOrEqual(NAME_BOUND_MS)
  })

  reg.define(/^a tap and a swipe down show "([^"]+)" and "([^"]+)"$/, async (w, firstArg, secondArg) => {
    expect(await heldPromises(w), 'the promises page').toEqual([String(firstArg), String(secondArg)])
  })

  reg.define(/^a tap and a swipe down show "([^"]+)"$/, async (w, heldArg) => {
    expect(await heldPromises(w), 'the promises page').toEqual([String(heldArg)])
  })

  // Rows 2 and 4, D89, D90, D47.
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
    // (Row 3's line is Dev's: from its fade through the wearer's next words, the dot alone, as for the wearer's.)
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
