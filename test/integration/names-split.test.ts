import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evenBridge, host } from '../harness/even-host.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { VirtualClock } from '../harness/clock.ts'
import { FixtureRun, FixtureStt } from '../harness/player.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { createSplit, SPLIT_NAMES, type SplitName } from '../../server/src/split/split.ts'
import { VARIANTS, type Variant } from '../fixtures/scripts.ts'
import { isDotOnly, linesShown, screenAt, screens, visible } from '../steps/lens-world.ts'

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
const servers = new Map<SplitName, { server: RunningServer; stt: FixtureStt }>()

beforeAll(async () => {
  for (const name of SPLIT_NAMES) {
    const stt = new FixtureStt(clock)
    const server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', audioToken: HARNESS_TOKEN, clock, stt, split: createSplit(name) })
    servers.set(name, { server, stt })
  }
})
afterAll(async () => {
  for (const { server } of servers.values()) await server.close()
})

async function waitUntil(test: () => boolean, ms = 2000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 20) await clock.sleepUntil(clock.now() + 20)
}

/** Plays `fixture` through the lens to `split`'s server up to fixture second `until`, then taps. */
async function play(split: SplitName, fixture: string, until: number): Promise<Outcome> {
  const { server, stt } = servers.get(split)!
  clock.reset()
  host.reset(clock)
  const { startLens } = await import('../../apps/lens/src/lens.ts')
  const lens = await startLens({ bridge: await evenBridge(), server: server.url.replace(/^http/, 'ws'), token: HARNESS_TOKEN, now: () => clock.now() })
  try {
    await lens.connected
    await waitUntil(() => isDotOnly(screenAt({ host }, clock.now()) ?? { at: 0, method: '', containers: [] }))
    const run = new FixtureRun(fixture, { clock, host, stt })
    const now = () => run.seconds(clock.now())
    // Every word played; the silences between them skipped.
    for (const wd of run.fixture.words) {
      if (wd.start >= until) break
      if (wd.start > now()) run.skipTo(wd.start)
      await run.playTo(wd.end)
    }
    await run.playTo(now() + 3.5)
    const lines = linesShown({ host }, 0, clock.now()).map((l) => l.text)
    const tappedAt = clock.now()
    host.push('textEvent', { containerID: 1 })
    const page = () => screens({ host }).find((s) => s.at >= tappedAt && s.containers.some((c) => c.containerName === 'names'))
    await waitUntil(() => page() !== undefined)
    const content = visible(page()!).find((c) => c.containerName === 'names')!.content
    return { lines, page: content === 'this conversation · nothing held' ? [] : content.split('\n') }
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
}

/** Loudness on the other-louder variant: the wearer heard as the other person, and the other person as the wearer. */
const INVERTED: Record<string, Outcome> = {
  // The conversation begins on Priya's words (heard as the wearer's), and the
  // introductions are heard as the wearer's own: nothing is caught.
  introductions: { lines: [], page: [] },
  // The wearer's own name is heard as someone else's introduction.
  'own-name-midway': { lines: ['Linus'], page: ['Linus'] },
  'priya-again-90s': { lines: [], page: [] },
}

describe('names under every split, on both fixture variants (two-fixture rule, D127)', () => {
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS as readonly Variant[]) {
      const inverted = split === 'loudness' && variant === 'other-louder'
      for (const [script, { until, outcome }] of Object.entries(RIGHT)) {
        const expected = inverted ? INVERTED[script]! : outcome
        const label = inverted ? 'known-inverted' : 'right'
        it(`${split} on ${script}.${variant} (${label}): lines ${JSON.stringify(expected.lines)}`, async () => {
          expect(await play(split, `${script}.${variant}`, until)).toEqual(expected)
        })
      }
    }
  }
})
