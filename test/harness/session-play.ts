import type { LensView } from '../../shared/lens-protocol.ts'
import type { ModelClient } from '../../server/src/llm/client.ts'
import { PromiseDetector } from '../../server/src/catch/promises.ts'
import { Session, type EndedConversation } from '../../server/src/catch/session.ts'
import { createSplit, type SplitName } from '../../server/src/split/split.ts'
import { framesFor, loadFixture } from '../fixtures/fixture.ts'
import { VirtualClock } from './clock.ts'
import { pcmAt } from './player.ts'

// A fixture straight into a session, frame by frame and word by word on a
// fixture clock that only moves when told, with the promise detector on
// `model`: what the session showed and what each conversation ended with.
// For the two-fixture rule under every split (test/unit/promise-split.test.ts)
// and for writing the hand cassettes (test/cassettes/by-hand.ts) from the
// very prompts the session builds.

export interface SessionPlay {
  views: { at: number; view: LensView }[]
  ended: EndedConversation[]
  errors: unknown[]
}

/** Plays the whole fixture, lets every model pass answer, then long-presses to end the conversation. */
export async function playIntoSession(fixture: string, split: SplitName, model: ModelClient): Promise<SessionPlay> {
  const fx = loadFixture(fixture)
  const clock = new VirtualClock(1)
  const out: SessionPlay = { views: [], ended: [], errors: [] }
  const session = new Session({
    clock,
    split: createSplit(split),
    show: (view) => out.views.push({ at: clock.now(), view }),
    promises: new PromiseDetector(model),
    onModelError: (e) => out.errors.push(e),
    onEnd: (e) => out.ended.push(e),
  })
  session.setHearing(true)
  const pcm = new Map<number, Uint8Array>()
  const items = [
    ...framesFor(fx).map((f, seq) => ({ t: f.end, kind: 0, f, seq })),
    ...fx.words.map((wd) => ({ t: wd.end, kind: 1, wd })),
  ].sort((a, b) => a.t - b.t || a.kind - b.kind)
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  for (const item of items) {
    clock.advance(Math.max(0, item.t * 1000 - clock.now()))
    if ('f' in item) {
      const { f, seq } = item
      if (!pcm.has(f.loudness)) pcm.set(f.loudness, pcmAt(f.loudness))
      session.frame({ seq, captureMs: f.end * 1000, speakerRole: f.role, direction: null, pcm: pcm.get(f.loudness)! })
    } else {
      const { wd } = item
      session.words([{ text: wd.text, start: wd.start, end: wd.end, speaker: wd.speaker, confidence: 1, isFinal: true }])
      // The model pass answers (from a cassette, at once) before the next word.
      await settle()
    }
  }
  clock.advance(2000)
  session.longPress()
  await settle()
  session.close()
  return out
}

/** The promise lines a play showed, in order. */
export const promiseLines = (play: SessionPlay) =>
  play.views.flatMap(({ view }) => (view.kind === 'line' && view.text.includes('promised · ') ? [view.text] : []))
