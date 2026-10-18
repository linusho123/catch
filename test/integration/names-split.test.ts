import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evenBridge, host } from '../harness/even-host.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { VirtualClock } from '../harness/clock.ts'
import { FixtureRun, FixtureStt } from '../harness/player.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { createSplit, SPLIT_NAMES, type SplitName } from '../../server/src/split/split.ts'
import { VARIANTS, type Variant } from '../fixtures/scripts.ts'
import { isDotOnly, isPage, lineIn, linesShown, NAME_BOUND_MS, namesOn, screenAt, screens } from '../steps/lens-world.ts'

// The two-fixture rule for P1a (BUILD-PLAN.md, Acceptance bars; D127): the
// names catches through the whole pipeline (fixture frames through the real
// lens on the real SDK, the server's split, the detector, the lens's payloads)
// under each of the three splits, on both variants. The speaker-role and
// provider-label splits read the roles the synthetic frames carry and must get
// both variants right. Loudness, the simulator default (D126), must get the
// wearer-louder variant right (names.feature binds that), and is pinned here
// as known-inverted on the other-louder one: it hears the wearer as the other
// person and the other person as the wearer.

interface Outcome {
  /** The name lines the lens showed, in order. */
  lines: string[]
  /** What a tap's names page listed. */
  page: string[]
}

const clock = new VirtualClock()
interface Served {
  server: RunningServer
  stt: FixtureStt
}
const servers = new Map<SplitName, Served>()
/** The loudness split with CATCH_WEARER_NAME=Linus. */
let named: Served

async function serve(split: SplitName, wearerName?: string): Promise<Served> {
  const stt = new FixtureStt(clock)
  const server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', audioToken: HARNESS_TOKEN, clock, stt, split: createSplit(split), wearerName })
  stt.attach(server.events)
  return { server, stt }
}

beforeAll(async () => {
  for (const name of SPLIT_NAMES) servers.set(name, await serve(name))
  named = await serve('loudness', 'Linus')
})
afterAll(async () => {
  for (const { server } of [...servers.values(), named]) await server.close()
})

async function waitUntil(test: () => boolean, ms = 2000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 20) await clock.sleepUntil(clock.now() + 20)
}

interface Played extends Outcome {
  run: FixtureRun
  /** The name lines with the clock reading each came up at. */
  shown: { at: number; text: string }[]
}

/**
 * Plays `fixture` through the lens to `split`'s server (or `to`) up to fixture
 * second `until`, then taps. With `outage`, the speech-to-text provider is
 * lost at fixture second `from` and comes back at `to`, and every frame
 * between is played (the lens keeps sending audio through an outage).
 */
async function play(split: SplitName, fixture: string, until: number, opts: { to?: Served; outage?: { from: number; to: number } } = {}): Promise<Played> {
  const { server, stt } = opts.to ?? servers.get(split)!
  server.forgetWearers()
  stt.reset()
  clock.reset()
  host.reset(clock)
  const { startLens } = await import('../../apps/lens/src/lens.ts')
  const lens = await startLens({ bridge: await evenBridge(), server: server.url.replace(/^http/, 'ws'), token: HARNESS_TOKEN, now: host.captureClock(clock) })
  try {
    await lens.connected
    await waitUntil(() => isDotOnly(screenAt({ host }, clock.now()) ?? { at: 0, method: '', containers: [] }))
    const run = new FixtureRun(fixture, { clock, host, stt })
    const now = () => run.seconds(clock.now())
    if (opts.outage) {
      await run.playTo(opts.outage.from)
      stt.loseConnection()
      await run.playTo(opts.outage.to)
      stt.restore()
    }
    // Every word played; the silences between them skipped, except around an outage.
    for (const wd of run.fixture.words) {
      if (wd.start >= until) break
      if (wd.end <= now()) continue
      if (wd.start > now() && !opts.outage) run.skipTo(wd.start)
      await run.playTo(run.frameEnd(wd.end))
    }
    await run.playTo(now() + 3.5)
    const shown = linesShown({ host }, 0, clock.now())
    const lines = shown.map((l) => l.text)
    const tappedAt = clock.now()
    host.push('textEvent', { containerID: 1 })
    const page = () => screens({ host }).find((s) => s.at >= tappedAt && isPage(s))
    await waitUntil(() => page() !== undefined)
    return { lines, page: namesOn(page()!), run, shown }
  } finally {
    await lens.stop()
  }
}

const RIGHT: Record<string, { until: number; outcome: Outcome }> = {
  // Priya, Marcus and Dana introduce themselves after the wearer opens.
  introductions: { until: 12, outcome: { lines: ['Priya', 'Marcus', 'Dana'], page: ['Priya', 'Marcus', 'Dana'] } },
  // D29: the wearer's own "Hi, I'm Linus" is never caught.
  'own-name-midway': { until: 10, outcome: { lines: [], page: [] } },
  // D88: a second Priya inside the window.
  'priya-again-90s': { until: 100, outcome: { lines: ['Priya', 'Priya (2)'], page: ['Priya', 'Priya (2)'] } },
  // D88: the same words three minutes later, outside the window: shown, listed once (M3).
  'priya-again-3min': { until: 190, outcome: { lines: ['Priya', 'Priya'], page: ['Priya'] } },
  // D88: a third Priya inside the window (M3).
  'priya-thrice': { until: 100, outcome: { lines: ['Priya', 'Priya (2)', 'Priya (3)'], page: ['Priya', 'Priya (2)', 'Priya (3)'] } },
  // D57: Priya re-introduces herself ten minutes later; one entry, in her first place (M3).
  'priya-reintroduced': { until: 610, outcome: { lines: ['Priya', 'Marcus', 'Priya'], page: ['Priya', 'Marcus'] } },
  // D129: the demo opener, Priya's introduction before the wearer has said anything.
  'demo-opener': { until: 5, outcome: { lines: ['Priya'], page: ['Priya'] } },
}

/** Loudness on the other-louder variant: the wearer heard as the other person, and the other person as the wearer. */
const INVERTED: Record<string, Outcome> = {
  // The conversation begins on the wearer's opening (heard as someone else's,
  // D129), and the introductions are heard as the wearer's own: nothing is caught.
  introductions: { lines: [], page: [] },
  // The wearer's own name is heard as someone else's introduction.
  'own-name-midway': { lines: ['Linus'], page: ['Linus'] },
  'priya-again-90s': { lines: [], page: [] },
  // Every "Hi, I'm Priya" is heard as the wearer giving their own name (D29): nothing is caught.
  'priya-again-3min': { lines: [], page: [] },
  'priya-thrice': { lines: [], page: [] },
  'priya-reintroduced': { lines: [], page: [] },
  'demo-opener': { lines: [], page: [] },
}

describe('names under every split, on both fixture variants (two-fixture rule, D127)', () => {
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS as readonly Variant[]) {
      const inverted = split === 'loudness' && variant === 'other-louder'
      for (const [script, { until, outcome }] of Object.entries(RIGHT)) {
        const expected = inverted ? INVERTED[script]! : outcome
        const label = inverted ? 'known-inverted' : 'right'
        it(`${split} on ${script}.${variant} (${label}): lines ${JSON.stringify(expected.lines)}`, async () => {
          const { lines, page } = await play(split, `${script}.${variant}`, until)
          expect({ lines, page }).toEqual(expected)
        })
      }
    }
  }
})

describe('the first conversation begins on anyone\'s speech (D129)', () => {
  it('catches the demo opener\'s Priya, said before the wearer has spoken, within two seconds', async () => {
    const { run, shown } = await play('loudness', 'demo-opener.wearer-louder', 5)
    const said = lineIn(run, "Hi, I'm Priya.")
    expect(run.fixture.words.filter((wd) => wd.end <= said.end).every((wd) => wd.role === 'other'), 'the wearer has not spoken before Priya').toBe(true)
    const line = shown.find((l) => l.text === 'Priya')
    expect(line, 'no "Priya" line').toBeDefined()
    expect(line!.at - run.at(said.end)).toBeGreaterThanOrEqual(0)
    expect(line!.at - run.at(said.end)).toBeLessThanOrEqual(NAME_BOUND_MS)
  })
})

describe('a configured wearer name (CATCH_WEARER_NAME) is never caught, whatever the split decides', () => {
  for (const script of ['own-name-midway', 'own-name']) {
    it(`loudness with CATCH_WEARER_NAME=Linus on ${script}.other-louder, where the split hears the wearer as someone else`, async () => {
      const { lines, page } = await play('loudness', `${script}.other-louder`, 10, { to: named })
      expect({ lines, page }).toEqual({ lines: [], page: [] })
    })
  }
})

describe('after a speech-to-text outage, the words of the new stream are placed on the session\'s timeline (M1)', () => {
  // The provider is lost at 1.5 s and back at 11.2 s; the server's next try
  // opens a stream at about 11.5 s, which times its words from there.
  const outage = { from: 1.5, to: 11.2 }
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS as readonly Variant[]) {
      if (split === 'loudness' && variant === 'other-louder') continue
      it(`${split} on linus-after-outage.${variant}: the wearer's "Hi, I'm Linus" is not caught and Priya's "Hi, I'm Priya" is`, async () => {
        const { lines, page, run } = await play(split, `linus-after-outage.${variant}`, 30, { outage })
        expect(run.fixture.words.some((wd) => wd.start >= outage.from && wd.end <= outage.to), 'words are said during the outage').toBe(true)
        expect({ lines, page }).toEqual({ lines: ['Priya'], page: ['Priya'] })
      })
    }
  }
})
