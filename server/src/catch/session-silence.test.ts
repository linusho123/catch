import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../../test/harness/clock.ts'
import { pcmAt } from '../../../test/harness/player.ts'
import type { FrameSignal, Side, SplitWord, WearerSplit } from '../split/split.ts'
import { loudnessSplit } from '../split/split.ts'
import type { SttWord } from '../stt/types.ts'
import { FRAME_HORIZON_S, Session } from './session.ts'

// PH (b): a lens left on all day streams a frame every 100 ms whether anyone
// speaks or not. The session keeps only the last minute of them before the
// newest frame, so an hour of silence leaves a bounded buffer, the split never
// reads hours of frames for one word, and names and the split work after it as
// before. The clock is near-frozen: the session's timeline comes from the
// frames' capture times, and no timer (the quiet rule's included) fires.

const WEARER = -12
const OTHER = -28
const FRAME_S = 0.1

/** The loudness split, with what each call was given and what it said of the newest word. */
function recordingSplit() {
  const inner = loudnessSplit()
  const calls: { frames: number; last: string; side: Side; frameless: string[] }[] = []
  const split: WearerSplit = {
    name: inner.name,
    classify(words: readonly SplitWord[], frames: readonly FrameSignal[]) {
      const sides = inner.classify(words, frames)
      // Words handed over with no frame under them: judged on audio that is gone.
      const frameless = words.filter((w) => !frames.some((f) => f.start < w.end && f.end > w.start)).map((w) => w.text)
      calls.push({ frames: frames.length, last: words.at(-1)!.text, side: sides.at(-1)!, frameless })
      return sides
    },
  }
  return { split, calls }
}

describe('a session left on through an hour of silence (PH)', () => {
  it('holds a bounded frame buffer, and still splits the speakers and catches a name after it', () => {
    const clock = new VirtualClock(0.001)
    const { split, calls } = recordingSplit()
    const lines: string[] = []
    const session = new Session({ clock, split, show: (view) => view.kind === 'line' && lines.push(view.text) })
    // The session's own buffer, read directly: what it holds, not what it says it holds.
    const held = () => (session as unknown as { frames: unknown[] }).frames.length
    let seq = 0
    const pcm = new Map<number, Uint8Array>()
    const frame = (end: number, dbfs: number) => {
      if (!pcm.has(dbfs)) pcm.set(dbfs, pcmAt(dbfs))
      session.frame({ seq: seq++, captureMs: Math.round(end * 1000), speakerRole: 'unknown', direction: null, pcm: pcm.get(dbfs)! })
    }
    const word = (text: string, start: number, end: number): SttWord => ({ text, start, end, confidence: 1, speaker: null, isFinal: true })
    const say = (text: string, start: number, dbfs: number) => {
      const words = text.split(' ').map((t, i) => word(t, start + i * 0.3, start + i * 0.3 + 0.3))
      for (let t = Math.round(start * 10) + 1; t <= Math.round(words.at(-1)!.end * 10); t++) frame(t / 10, dbfs)
      session.words(words)
    }
    session.setHearing(true)
    say('Hello there.', 0, WEARER)
    say("Hi, I'm Priya.", 2, OTHER)
    expect(lines).toEqual(['Priya'])

    // An hour of frames with nothing said in them.
    const quietFrom = 3
    const hour = 60 * 60
    for (let t = Math.round(quietFrom / FRAME_S) + 1; t <= Math.round((quietFrom + hour) / FRAME_S); t++) frame(t * FRAME_S, -90)
    const bound = Math.ceil(FRAME_HORIZON_S / FRAME_S) + 2
    expect(FRAME_HORIZON_S).toBe(60)
    expect(held(), 'frames held after an hour of silence').toBeLessThanOrEqual(bound)

    // After it, the split and the names work as before, on no more than the last minute of frames.
    const after = quietFrom + hour + 1
    const before = calls.length
    say('Good to see you again.', after, WEARER)
    say("Hi, I'm Marcus.", after + 3, OTHER)
    const since = calls.slice(before)
    expect(since.find((c) => c.last === 'again.')?.side).toBe('wearer')
    expect(since.find((c) => c.last === 'Marcus.')?.side).toBe('other')
    expect(Math.max(...since.map((c) => c.frames)), 'frames the split read for one word').toBeLessThanOrEqual(bound)
    // The words from before the hour left the split's window with their frames: none is judged on audio that is gone.
    expect(since.flatMap((c) => c.frameless), 'words the split was handed with no frames under them').toEqual([])
    expect(lines).toEqual(['Priya', 'Marcus'])
    expect(session.names.list()).toEqual(['Priya', 'Marcus'])
    session.close()
  })
})
