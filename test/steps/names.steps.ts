import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
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
  NAME_BOUND_MS,
  pend,
  playTo,
  quoted,
  rememberLines,
  screenAt,
  screens,
  screensDuring,
  SLACK_MS,
  startRun,
  tapForNames,
  visible,
  type LensWorld,
} from './lens-world.ts'

// names.feature (P1a). The default split, loudness (D126), on the wearer-louder
// fixtures: the plan's two-fixture rule asks only those to go green on the
// simulator default (D127); the other-louder variants are pinned, as known
// inverted under loudness and as passing under the other two splits, in
// test/integration/names-split.test.ts. Every "sees" is read from the bridge
// stub's record on fixture time (lens-world.ts).

const V = 'wearer-louder'

/** Fixture seconds between two introductions, for the steps that name the gap. */
const GAPS: Record<string, { fixture: string; seconds: number }> = {
  '90 seconds': { fixture: `priya-again-90s.${V}`, seconds: 90 },
  '3 minutes': { fixture: `priya-again-3min.${V}`, seconds: 180 },
}

/** Plays a line someone says and marks when it was said (its last word's end). */
async function say(w: LensWorld, text: string, after: number, role: 'wearer' | 'other'): Promise<void> {
  const line = lineIn(w.run!, text, after)
  expect(line.words.every((wd) => wd.role === role), `"${text}" in ${w.run!.name} is not said by ${role === 'wearer' ? 'the wearer' : 'someone else'}`).toBe(true)
  await playTo(w, line.end)
  w.saidLine = line
  w.saidAt = w.run!.at(line.end)
}

const names: Definer<LensWorld> = (reg) => {
  reg.define(/^the wearer is in a conversation and the lens shows only the dot$/, async (w) => {
    await begin(w)
    pend(w, 'in-conversation, dot only')
  })

  reg.define(/^Priya says "Hi, I'm Priya"$/, async (w) => {
    const run = await startRun(w, `priya.${V}`, 2.9)
    await say(w, "Hi, I'm Priya.", run.seconds(w.h!.clock.now()), 'other')
  })

  reg.define(/^within two seconds the wearer sees "([^"]+)" in dim text in the lower third of the lens$/, async (w, nameArg) => {
    const name = String(nameArg)
    await playTo(w, w.run!.seconds(w.saidAt!) + NAME_BOUND_MS / 1000)
    const line = screens(w.h!).find((s) => s.at >= w.saidAt! && isLine(s, name))
    expect(line, `no dim lower-third "${name}" within two seconds of ${w.saidAt} ms`).toBeDefined()
    expect(line!.at - w.saidAt!).toBeLessThanOrEqual(NAME_BOUND_MS)
    w.lineAt = line!.at
  })

  reg.define(/^the wearer sees the name fade after a second and a half$/, async (w) => {
    await playTo(w, w.run!.seconds(w.lineAt!) + (LINE_MS + 2 * SLACK_MS) / 1000)
    const all = screens(w.h!)
    const i = all.findIndex((s) => s.at === w.lineAt)
    const next = all[i + 1]
    expect(next, 'the name never faded').toBeDefined()
    expect(Math.abs(next!.at - w.lineAt! - LINE_MS), `the name stayed ${next!.at - w.lineAt!} ms`).toBeLessThanOrEqual(SLACK_MS)
    expect(visible(next!).map((c) => c.content)).not.toContain(visible(all[i]!)[0]!.content)
  })

  reg.define(/^the wearer then sees only the dot$/, (w) => {
    const all = screens(w.h!)
    const after = all[all.findIndex((s) => s.at === w.lineAt) + 1]
    expectDotOnly(after, 'when the name fades')
    expectDotOnly(screenAt(w.h!, w.h!.clock.now()), 'now')
  })

  reg.define(/^the wearer says "Hi, I'm Linus"$/, async (w) => {
    const run = await startRun(w, `own-name-midway.${V}`, 3.9)
    await say(w, "Hi, I'm Linus.", run.seconds(w.h!.clock.now()), 'wearer')
    // Priya answers; then as long as any name line could take to come up.
    const reply = lineIn(run, 'Nice to meet you.', w.saidLine!.end)
    await playTo(w, reply.end + NAME_BOUND_MS / 1000 + SLACK_MS / 1000)
  })

  reg.define(/^the wearer sees no line on the lens$/, (w) => {
    for (const s of screensDuring(w.h!, w.saidAt!, w.h!.clock.now())) expectDotOnly(s, 'after "Hi, I\'m Linus"')
  })

  reg.define(/^a tap shows no "([^"]+)" among the held names$/, async (w, nameArg) => {
    const name = String(nameArg)
    const held = await tapForNames(w)
    expect(held.some((l) => l.includes(name)), `the names page lists ${JSON.stringify(held)}`).toBe(false)
  })

  reg.define(/^Priya introduced herself at the start of the conversation$/, async (w) => {
    await begin(w)
    pend(w, 'Priya introduced at the start')
  })

  reg.define(/^ten minutes later Priya says "I'm Priya" again to someone who just joined$/, async (w) => {
    const run = await startRun(w, `priya-reintroduced.${V}`, 12)
    rememberLines(w)
    const first = lineIn(run, "Hi, I'm Priya.")
    const again = lineIn(run, "I'm Priya.", 12)
    expect(again.start - first.start, 'ten minutes between the introductions').toBe(600)
    // Someone just joined: the wearer says so, then Priya introduces herself to them.
    const joined = lineIn(run, 'Oh, here comes someone new.', 12)
    expect(joined.words.every((wd) => wd.role === 'wearer')).toBe(true)
    await fastForward(w, joined.start - 0.5)
    await say(w, "I'm Priya.", joined.end, 'other')
  })

  reg.define(/^the wearer sees "([^"]+)" in dim text for a second and a half$/, async (w, textArg) => {
    const text = String(textArg)
    await expectLineForASecondAndAHalf(w, text)
  })

  reg.define(/^a tap shows "([^"]+)" once, in her original position$/, async (w, nameArg) => {
    const name = String(nameArg)
    const held = await tapForNames(w)
    expect(held.filter((n) => n === name), `the names page lists ${JSON.stringify(held)}`).toHaveLength(1)
    // The names page is in the order heard: as the name lines came up before the re-introduction.
    expect(w.linesBefore).toContain(name)
    expect(held).toEqual(w.linesBefore)
    expect(held.indexOf(name)).toBe(w.linesBefore!.indexOf(name))
  })

  reg.define(/^(90 seconds|3 minutes) later someone says "Hi, I'm Priya"$/, async (w, laterArg) => {
    const later = String(laterArg)
    const { fixture, seconds } = GAPS[later]!
    const run = await startRun(w, fixture, 8)
    const first = lineIn(run, "Hi, I'm Priya.")
    const again = lineIn(run, "Hi, I'm Priya.", first.end)
    expect(again.start - first.start, `${later} between the introductions`).toBe(seconds)
    await fastForward(w, again.start - 0.5)
    await say(w, "Hi, I'm Priya.", first.end, 'other')
  })

  reg.define(/^a tap shows the names page listing (.+) in the order heard$/, async (w, listingArg) => {
    const listing = String(listingArg)
    const expected = quoted(listing)
    expect(expected.length, `no quoted names in ${listing}`).toBeGreaterThan(0)
    if (listing.endsWith(' alone')) expect(expected).toHaveLength(1)
    expect(await tapForNames(w)).toEqual(expected)
  })

  reg.define(/^Priya introduced herself and, 60 seconds later, a second person said "Hi, I'm Priya"$/, async (w) => {
    await begin(w)
    const run = await startRun(w, `priya-thrice.${V}`, 8)
    const first = lineIn(run, "Hi, I'm Priya.")
    const second = lineIn(run, "Hi, I'm Priya.", first.end)
    expect(second.start - first.start).toBe(60)
    await fastForward(w, second.start - 0.5)
    await playTo(w, second.end + (NAME_BOUND_MS + LINE_MS + SLACK_MS) / 1000)
    expect(linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text)).toEqual(['Priya', 'Priya (2)'])
    expect(isDotOnly(screenAt(w.h!, w.h!.clock.now())!)).toBe(true)
  })

  reg.define(/^30 seconds after that a third person says "Hi, I'm Priya"$/, async (w) => {
    const run = w.run!
    const first = lineIn(run, "Hi, I'm Priya.")
    const second = lineIn(run, "Hi, I'm Priya.", first.end)
    const third = lineIn(run, "Hi, I'm Priya.", second.end)
    expect(third.start - second.start).toBe(30)
    await fastForward(w, third.start - 0.5)
    await say(w, "Hi, I'm Priya.", second.end, 'other')
  })

  reg.define(/^a tap shows ((?:"[^"]+"(?:, | and )?)+) in the order heard$/, async (w, listingArg) => {
    const listing = String(listingArg)
    expect(await tapForNames(w)).toEqual(quoted(listing))
  })
}

export default names
