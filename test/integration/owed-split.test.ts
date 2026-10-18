import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evenBridge, host } from '../harness/even-host.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { VirtualClock } from '../harness/clock.ts'
import { modelForTests } from '../harness/model.ts'
import { linesOf, NotificationCapture } from '../harness/notifications.ts'
import { FixtureRun, FixtureStt } from '../harness/player.ts'
import { startServer, type RunningServer } from '../../server/src/app.ts'
import { createSplit, SPLIT_NAMES, type SplitName } from '../../server/src/split/split.ts'
import { VARIANTS, type Variant } from '../fixtures/scripts.ts'
import { isDotOnly, isPage, isPromisesPage, linesShown, namesOn, promisesOn, screenAt, screens } from '../steps/lens-world.ts'

// The two-fixture rule for P5 (BUILD-PLAN.md, Acceptance bars; D127): the
// promises owed to the wearer through the whole pipeline (fixture frames
// through the real lens on the real SDK, the server's split, the detectors on
// the committed cassettes, the lens's payloads, the phone's notification)
// under the speaker-role and provider-label splits on both variants, and the
// loudness split, the simulator default (D126), on the wearer-louder one. Every
// outcome is read on the far side: the lines and the promises page from the
// bridge stub's record, the notification from the capture. Loudness on the
// other-louder variant is known-inverted and pinned in
// test/unit/promise-split.test.ts.

interface Outcome {
  /** Every line the lens showed, names and promises, in order. */
  lines: string[]
  /** What a tap and a swipe down showed on the promises page at the end. */
  page: string[]
  /** The notification the phone showed once the conversation ended: its lines, title first. */
  notification: string[]
}

const RIGHT: Record<string, Outcome> = {
  // D91: Dev, caught, promises after the wearer; the pronoun turned.
  'owed-agenda': {
    lines: ['Dev', 'promised · send Dev the deck tonight', 'Dev promised · send the agenda'],
    page: ['send Dev the deck tonight', 'owed: Dev sends the agenda'],
    notification: ['Catch', 'Send Dev the deck tonight', 'Owed to you: Dev sends the agenda'],
  },
  // D26, D113: unnamed when promised, then the name caught attaches.
  'owed-unnamed': {
    lines: ['they promised · send the deck tonight', 'Dev'],
    page: ['owed: Dev sends the deck tonight'],
    notification: ['Catch', 'Owed to you: Dev sends the deck tonight'],
  },
  // D113: two unnamed; the name attaches to the most recent only.
  'owed-two': {
    lines: ['they promised · send the deck tonight', 'they promised · send the slides', 'Dev'],
    page: ['owed: they (1) sends the deck tonight', 'owed: Dev sends the slides'],
    notification: ['Catch', 'Owed to you: they (1) sends the deck tonight and Dev sends the slides'],
  },
  // D117: both lines of the one notification.
  handoff: {
    lines: ['Dev', 'promised · send Dev the deck tonight', 'promised · introduce Dev to Sam', 'Dev promised · send the agenda'],
    page: ['send Dev the deck tonight', 'introduce Dev to Sam', 'owed: Dev sends the agenda'],
    notification: ['Catch', 'Send Dev the deck tonight and introduce Dev to Sam', 'Owed to you: Dev sends the agenda'],
  },
}

const clock = new VirtualClock()
interface Served {
  server: RunningServer
  stt: FixtureStt
  notifications: NotificationCapture
}
const servers = new Map<SplitName, Served>()

beforeAll(async () => {
  const model = modelForTests()
  for (const split of SPLIT_NAMES) {
    const stt = new FixtureStt(clock)
    const notifications = new NotificationCapture(clock)
    const server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', audioToken: HARNESS_TOKEN, clock, stt, model, notifier: notifications, split: createSplit(split) })
    stt.attach(server.events)
    servers.set(split, { server, stt, notifications })
  }
})
afterAll(async () => {
  for (const { server } of servers.values()) await server.close()
})

async function waitUntil(test: () => boolean, ms = 2000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 20) await clock.sleepUntil(clock.now() + 20)
}

/** Plays `fixture` through the lens to `split`'s server, every word (the silences skipped), then a tap, a swipe down, and a long-press. */
async function play(split: SplitName, fixture: string): Promise<Outcome & { modelErrors: unknown[] }> {
  const { server, stt, notifications } = servers.get(split)!
  server.forgetWearers()
  stt.reset()
  clock.reset()
  host.reset(clock)
  notifications.reset(clock)
  const modelErrors: unknown[] = []
  const onError = ({ error }: { error: unknown }) => modelErrors.push(error)
  server.events.on('modelError', onError)
  const { startLens } = await import('../../apps/lens/src/lens.ts')
  const lens = await startLens({ bridge: await evenBridge(), server: server.url.replace(/^http/, 'ws'), token: HARNESS_TOKEN, now: host.captureClock(clock) })
  try {
    await lens.connected
    await waitUntil(() => isDotOnly(screenAt({ host }, clock.now()) ?? { at: 0, method: '', containers: [] }))
    const run = new FixtureRun(fixture, { clock, host, stt })
    const now = () => run.seconds(clock.now())
    for (const wd of run.fixture.words) {
      if (wd.end <= now()) continue
      // A silence is skipped once a second of it has played: on the cassettes a pass answers at once, so any line is up by then.
      if (wd.start > now() + 1) {
        await run.playTo(now() + 1)
        if (wd.start > now()) run.skipTo(wd.start)
      }
      await run.playTo(run.frameEnd(wd.end))
    }
    // The last line comes and goes (D17's second and a half), so the tap finds the dot.
    await run.playTo(now() + 2)
    const lines = linesShown({ host }, 0, clock.now()).map((l) => l.text)
    const tappedAt = clock.now()
    host.push('textEvent', { containerID: 1 })
    await waitUntil(() => screens({ host }).some((s) => s.at >= tappedAt && isPage(s)))
    const names = screens({ host }).find((s) => s.at >= tappedAt && isPage(s))!
    expect(namesOn(names), 'the names page lists the names the lens caught').toEqual(lines.filter((l) => !l.includes('promised · ')))
    const swipedAt = clock.now()
    host.push('textEvent', { containerID: 3, containerName: 'names', eventType: 2 })
    await waitUntil(() => screens({ host }).some((s) => s.at >= swipedAt && isPromisesPage(s)))
    const page = promisesOn(screens({ host }).find((s) => s.at >= swipedAt && isPromisesPage(s))!)
    host.push('sysEvent', { eventType: 9, eventSource: 1 })
    await waitUntil(() => notifications.received.length > 0)
    return { lines, page, notification: notifications.received.map((c) => linesOf(c.notification)).flat(), modelErrors }
  } finally {
    server.events.off('modelError', onError)
    await lens.stop()
  }
}

describe('promises owed to the wearer under every split, on both fixture variants (two-fixture rule, D127)', () => {
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS as readonly Variant[]) {
      if (split === 'loudness' && variant === 'other-louder') continue
      for (const [script, expected] of Object.entries(RIGHT)) {
        it(`${split} on ${script}.${variant}: ${JSON.stringify(expected.page)}`, async () => {
          const { modelErrors, ...outcome } = await play(split, `${script}.${variant}`)
          expect(modelErrors).toEqual([])
          expect(outcome).toEqual(expected)
        })
      }
    }
  }
})
