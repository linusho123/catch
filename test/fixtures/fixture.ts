import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FrameSignal, Side, SplitWord } from '../../server/src/split/split.ts'
import type { ScriptLine, Variant } from './scripts.ts'

// The pre-transcribed word-timing fixture format (version 1). Every word has
// its timing in seconds, its role (the ground truth from the script), its
// loudness in dBFS and the provider's diarization label. A fixture recorded
// on real glasses may also carry `frames` with the SDK's per-frame
// speakerRole; synthetic ones do not, and framesFor() derives them.

export const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
export const FRAME_SECONDS = 0.1
export const SILENCE_DBFS = -70

export interface FixtureWord {
  text: string
  start: number
  end: number
  role: Side
  loudness: number
  speaker: number
}

export interface Fixture {
  fixture: 1
  synthetic: boolean
  script: string
  variant: Variant
  lines: ScriptLine[]
  words: FixtureWord[]
  frames?: FrameSignal[]
}

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort()
}

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as Fixture
}

export function splitWords(fx: Fixture): SplitWord[] {
  return fx.words.map(({ text, start, end, speaker }) => ({ text, start, end, speaker }))
}

/**
 * 100 ms frames over the whole fixture. Recorded frames win; otherwise each
 * frame takes the role and loudness of the word covering most of it, and a
 * frame with no word is silence. `roleless` gives every frame the role
 * `unknown`, as the simulator and the phone mic do (D126).
 */
export function framesFor(fx: Fixture, opts: { roleless?: boolean } = {}): FrameSignal[] {
  const base = fx.frames ?? synthesizeFrames(fx)
  return opts.roleless ? base.map((f) => ({ ...f, role: 'unknown' })) : base
}

function synthesizeFrames(fx: Fixture): FrameSignal[] {
  const last = fx.words.at(-1)
  if (!last) return []
  const frames: FrameSignal[] = []
  const count = Math.ceil(last.end / FRAME_SECONDS)
  for (let i = 0; i < count; i++) {
    const start = Math.round(i * FRAME_SECONDS * 1000) / 1000
    const end = Math.round((i + 1) * FRAME_SECONDS * 1000) / 1000
    let best: FixtureWord | undefined
    let bestOverlap = 0
    for (const w of fx.words) {
      const overlap = Math.min(end, w.end) - Math.max(start, w.start)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = w
      }
    }
    frames.push(
      best
        ? { start, end, role: best.role === 'wearer' ? 'self' : 'other', loudness: best.loudness }
        : { start, end, role: 'unknown', loudness: SILENCE_DBFS },
    )
  }
  return frames
}
