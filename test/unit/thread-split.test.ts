import { describe, expect, it } from 'vitest'
import type { LensView } from '../../shared/lens-protocol.ts'
import { threadDetectionFromEnv } from '../../server/src/app.ts'
import { Session } from '../../server/src/catch/session.ts'
import { createSplit, SPLIT_NAMES, type SplitName } from '../../server/src/split/split.ts'
import { VirtualClock } from '../harness/clock.ts'
import { pcmAt } from '../harness/player.ts'
import { framesFor, loadFixture } from '../fixtures/fixture.ts'
import { VARIANTS } from '../fixtures/scripts.ts'

// The two-fixture rule (BUILD-PLAN.md, Acceptance bars; D127) for P3's
// dropped thread, which rests on the split: the thread is the wearer's run,
// and the floor is someone else's. The P3 fixtures go straight into a
// session, frame by frame and word by word on the fixture clock, under each
// split on both variants (the end-to-end path is dropped-thread.feature's, on
// the default split and the wearer-louder variant). The speaker-role and
// provider-label splits must get both variants right. Loudness, the simulator
// default (D126), must get the wearer-louder variant right and is pinned here
// as known-inverted on the other-louder one: the wearer's unfinished run is
// heard as someone else taking the floor, and the other person's finished
// questions as the wearer's run, so no line ever comes; and with detection
// off the held page gives back the other person's last words as the wearer's.

interface Outcome {
  /** The dropped-thread lines the lens was sent, in order. */
  lines: string[]
  /** With detection off: no line ever, and a tap at the end gives this page. */
  page?: LensView
}

/** Plays the whole fixture; with `tapAt`, the wearer taps at that fixture second and `page` is what the tap brought up. */
function play(fixture: string, split: SplitName, detection = true, tapAt = Infinity): { lines: string[]; views: LensView[]; page?: LensView } {
  const fx = loadFixture(fixture)
  const clock = new VirtualClock(1)
  const views: LensView[] = []
  const session = new Session({ clock, split: createSplit(split), show: (v) => views.push(v), threadDetection: () => detection })
  session.setHearing(true)
  const pcm = new Map<number, Uint8Array>()
  let page: LensView | undefined
  const items = [
    ...framesFor(fx).map((f, seq) => ({ t: f.end, kind: 0, f, seq })),
    ...fx.words.map((wd) => ({ t: wd.end, kind: 1, wd })),
  ].sort((a, b) => a.t - b.t || a.kind - b.kind)
  for (const item of items) {
    if (page === undefined && item.t > tapAt) {
      clock.advance(Math.max(0, tapAt * 1000 - clock.now()))
      session.tap()
      page = session.current()
    }
    clock.advance(Math.max(0, item.t * 1000 - clock.now()))
    if ('f' in item) {
      const { f, seq } = item
      if (!pcm.has(f.loudness)) pcm.set(f.loudness, pcmAt(f.loudness))
      session.frame({ seq, captureMs: f.end * 1000, speakerRole: f.role, direction: null, pcm: pcm.get(f.loudness)! })
    } else {
      const { wd } = item
      session.words([{ text: wd.text, start: wd.start, end: wd.end, speaker: wd.speaker, confidence: 1, isFinal: true }])
    }
  }
  clock.advance(2000)
  const lines = views.flatMap((v) => (v.kind === 'line' && v.text.startsWith('…') ? [v.text] : []))
  return { lines, views, page }
}

const RIGHT: Record<string, string[]> = {
  // D35: Dev cuts in on "…and the second reason is".
  'dropped-thread': ['…and the second reason is'],
  // D49: the run carries across a pause with nobody speaking.
  'thread-continuous': ['…we chose it. Well, the'],
  // D50: Dev's "Makes sense." ends the earlier run.
  'thread-across-turn': ['…Well, the'],
  // D33: a finished sentence, then Marcus.
  'normal-turn': [],
  // D36: five minutes of silence.
  'thinking-pause': [],
}

describe('the dropped thread under every split, on both fixture variants (two-fixture rule, D127)', () => {
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS) {
      const inverted = split === 'loudness' && variant === 'other-louder'
      for (const [script, right] of Object.entries(RIGHT)) {
        const expected = inverted ? [] : right
        it(`${split} on ${script}.${variant} (${inverted ? 'known-inverted' : 'right'}): ${JSON.stringify(expected)}`, () => {
          expect(play(`${script}.${variant}`, split).lines).toEqual(expected)
        })
      }

      // D120: with detection off, no line comes on its own, and a tap once Dev has the floor
      // (fixture second 18, his question half asked) gives the thread back above the names.
      const off: Outcome = inverted
        ? { lines: [], page: { kind: 'names', names: [], thread: '…a quick question about the' } }
        : { lines: [], page: { kind: 'names', names: ['Priya'], thread: '…and the second reason is' } }
      it(`${split} on dropped-thread.${variant} with detection off (${inverted ? 'known-inverted' : 'right'})`, () => {
        const { lines, views, page } = play(`dropped-thread.${variant}`, split, false, 18)
        expect(views.some((v) => v.kind === 'line' && v.text.startsWith('…')), 'a thread line came on its own').toBe(false)
        expect({ lines, page }).toEqual(off)
      })
    }
  }
})

describe('the operator\'s switch, CATCH_THREAD_DETECTION (D120)', () => {
  it('is on when unset or "on", off only when "off", and refuses anything else', () => {
    expect(threadDetectionFromEnv(undefined)).toBe(true)
    expect(threadDetectionFromEnv('')).toBe(true)
    expect(threadDetectionFromEnv('on')).toBe(true)
    expect(threadDetectionFromEnv(' OFF ')).toBe(false)
    expect(() => threadDetectionFromEnv('false')).toThrow(/CATCH_THREAD_DETECTION/)
  })
})
