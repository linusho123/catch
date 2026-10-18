import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evenBridge, host } from '../harness/even-host.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { VirtualClock } from '../harness/clock.ts'
import { FixtureRun, FixtureStt } from '../harness/player.ts'
import { modelForListenUrl, type ProviderModel } from '../harness/provider-model.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { createSplit, type SplitName } from '../../server/src/split/split.ts'
import { deepgramUrl } from '../../server/src/stt/deepgram.ts'
import type { Variant } from '../fixtures/scripts.ts'
import { isDotOnly, isLine, isPage, linesShown, NAME_BOUND_MS, namesOn, screenAt, screens } from '../steps/lens-world.ts'

// PT: the time bounds on a provider that answers like the real one. The
// fixture provider here sends what provider-model.ts says Deepgram sends for
// the listen URL the server really opens (deepgramUrl(): its endpointing and
// utterance-end settings): interims every 300 ms while someone speaks, finals
// only at a pause longer than the endpointing or after about four seconds of
// continuous speech, UtteranceEnds after a second's gap. Then, on fixture time,
// measured at the far side (the payloads the lens sent the Even bridge):
//   - D17: Priya's "I'm Priya", said in the middle of a nine-second turn with
//     no pause in it, shows within two seconds of the name's end;
//   - D89: the wearer's "Sure I'll send you the deck tonight", with no closing
//     punctuation and then a pause before the wearer goes on, shows its
//     promise within three seconds of the sentence's end.
// The model answers at once, like a cassette, so the time measured is the
// provider's and the server's. The fixture clock runs twenty times wall time,
// so any real time spent on the way only adds to what is measured.

const clock = new VirtualClock()
const PROMISE_BOUND_MS = 3000

/** Answers a promise for the one sentence the fixture promises in, at once; no promise for anything else. */
const model: ModelClient = {
  complete(_m, prompt) {
    const said = /^The wearer now says: (.*)$/m.exec(prompt)?.[1]
    return Promise.resolve(JSON.stringify(said === "Sure I'll send you the deck tonight" ? { promise: true, summary: 'send Priya the deck tonight' } : { promise: false }))
  },
}

interface Served {
  server: RunningServer
  stt: FixtureStt
}
const servers = new Map<SplitName, Served>()

beforeAll(async () => {
  for (const split of ['loudness', 'speaker-role'] as const) {
    const stt = new FixtureStt(clock)
    const server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', audioToken: HARNESS_TOKEN, clock, stt, split: createSplit(split), model })
    stt.attach(server.events)
    servers.set(split, { server, stt })
  }
})
afterAll(async () => {
  for (const { server } of servers.values()) await server.close()
})

async function waitUntil(test: () => boolean, ms = 2000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 20) await clock.sleepUntil(clock.now() + 20)
}

/**
 * Plays the whole of `fixture` through the lens to `split`'s server on
 * `provider`, then taps for the names page. With `skip`, the clock jumps the
 * silences between words (the provider's messages in them still sent, each at its time).
 */
async function play(split: SplitName, fixture: string, provider: ProviderModel, skip = false) {
  const { server, stt } = servers.get(split)!
  server.forgetWearers()
  stt.reset()
  clock.reset()
  host.reset(clock)
  const { startLens } = await import('../../apps/lens/src/lens.ts')
  const lens = await startLens({ bridge: await evenBridge(), server: server.url.replace(/^http/, 'ws'), token: HARNESS_TOKEN, now: host.captureClock(clock) })
  try {
    await lens.connected
    await waitUntil(() => isDotOnly(screenAt({ host }, clock.now()) ?? { at: 0, method: '', containers: [] }))
    const run = new FixtureRun(fixture, { clock, host, stt, provider })
    if (skip) {
      const now = () => run.seconds(clock.now())
      for (const wd of run.fixture.words) {
        if (wd.end <= now()) {
          await run.playTo(run.frameEnd(wd.end))
          continue
        }
        if (wd.start > now()) run.skipTo(wd.start)
        await run.playTo(run.frameEnd(wd.end))
      }
    }
    // Every frame and every message, in real order on the fixture clock.
    await run.playTo()
    // The last final (a pause's 300 ms) and utterance end (a second) are in; any line has faded.
    await run.playTo(run.seconds(clock.now()) + 2)
    const tappedAt = clock.now()
    host.push('textEvent', { containerID: 1 })
    const page = () => screens({ host }).find((s) => s.at >= tappedAt && isPage(s))
    await waitUntil(() => page() !== undefined)
    return { run, page: page() ? namesOn(page()!) : undefined }
  } finally {
    await lens.stop()
  }
}

const word = (run: FixtureRun, text: string) => {
  const found = run.fixture.words.find((w) => w.text === text)
  if (!found) throw new Error(`no "${text}" in ${run.name}`)
  return found
}

/** When `text` first came up as a dim lower-third line at or after `from` (a clock reading), or undefined. */
const lineAt = (text: string, from: number) => screens({ host }).find((s) => s.at >= from && isLine(s, text))?.at

const RUNS: [SplitName, Variant][] = [
  // The simulator's split (D126) on the variant it hears right.
  ['loudness', 'wearer-louder'],
  // The two-fixture rule: the other person louder, on a split that hears it right.
  ['speaker-role', 'other-louder'],
]

describe('the time bounds on a provider that answers like Deepgram (PT)', () => {
  it('models the listen URL the server opens: 300 ms endpointing, a second for an utterance end', () => {
    expect(modelForListenUrl(deepgramUrl())).toMatchObject({ endpointingMs: 300, utteranceEndMs: 1000 })
  })

  for (const [split, variant] of RUNS) {
    it(`shows a name said mid-turn within two seconds, and a promise within three of its sentence's end (${split}, ${variant})`, async () => {
      const { run, page } = await play(split, `long-turn.${variant}`, modelForListenUrl(deepgramUrl()))
      // D17: from the end of "Priya" in the middle of the long turn.
      const priya = run.at(word(run, 'Priya').end)
      const shown = lineAt('Priya', priya)
      expect(shown, 'the name never showed').toBeDefined()
      expect(shown! - priya, `"Priya" showed ${shown! - priya} ms after it was said`).toBeLessThanOrEqual(NAME_BOUND_MS)
      // D89: from the end of "tonight", the sentence's last word.
      const tonight = run.at(word(run, 'tonight').end)
      const promised = lineAt('promised · send Priya the deck tonight', tonight)
      expect(promised, 'the promise never showed').toBeDefined()
      expect(promised! - tonight, `the promise showed ${promised! - tonight} ms after its sentence ended`).toBeLessThanOrEqual(PROMISE_BOUND_MS)
      // Once each, never again when the final confirms it; and the name is held once.
      const lines = screens({ host }).filter((s) => isLine(s, 'Priya') || isLine(s, 'Priya (2)'))
      expect(lines.map((s) => s.at)).toEqual([shown])
      expect(page).toEqual(['Priya'])
    })
  }
})

// The names fixtures on the same provider: every name now shows from an
// interim and is confirmed by its final, so each must still show once, be
// held once, and keep D29, D87, D88 and D132, exactly as on finals alone
// (test/integration/names-split.test.ts holds the same outcomes there).
const NAMES: Record<string, { lines: string[]; page: string[] }> = {
  // Priya (2) at 93 s, inside D87's window; Priya again at 610 s, outside it: shown, listed once.
  introductions: { lines: ['Priya', 'Marcus', 'Dana', 'Priya (2)', 'Priya'], page: ['Priya', 'Marcus', 'Dana', 'Priya (2)'] },
  'own-name-midway': { lines: [], page: [] },
  'priya-thrice': { lines: ['Priya', 'Priya (2)', 'Priya (3)'], page: ['Priya', 'Priya (2)', 'Priya (3)'] },
  'demo-opener': { lines: ['Priya'], page: ['Priya'] },
  'meet-priya': { lines: ['Dev', 'Priya', 'Priya'], page: ['Dev', 'Priya'] },
}

describe('names on a provider that answers like Deepgram: once each, as on finals (PT)', () => {
  for (const [split, variant] of RUNS) {
    for (const [fixture, want] of Object.entries(NAMES)) {
      it(`${fixture} (${split}, ${variant})`, async () => {
        const { run, page } = await play(split, `${fixture}.${variant}`, modelForListenUrl(deepgramUrl()), true)
        const lines = linesShown({ host }, run.epoch, clock.now()).map((l) => l.text)
        expect(lines).toEqual(want.lines)
        expect(page).toEqual(want.page)
      })
    }
  }
})
