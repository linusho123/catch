import { describe, expect, it } from 'vitest'
import { Session } from '../../server/src/catch/session.ts'
import { createSplit, SPLIT_NAMES } from '../../server/src/split/split.ts'
import { VirtualClock } from '../harness/clock.ts'
import { pcmAt } from '../harness/player.ts'
import { framesFor, loadFixture } from '../fixtures/fixture.ts'
import { VARIANTS } from '../fixtures/scripts.ts'

// The two-fixture rule (BUILD-PLAN.md, Acceptance bars; D127) for P1b's
// conversation boundary, which rests on the split: the quiet that ends a
// conversation is the wearer's (D92). The quiet fixtures go straight into a
// session, frame by frame and word by word on the fixture clock, under each
// split on both variants. The speaker-role and provider-label splits get both
// right; loudness, the simulator default (D126), gets the wearer-louder one
// right (holding.feature binds that end to end) and is pinned here as
// known-inverted on the other-louder one: Dev's talk is heard as the wearer's,
// so the conversation never ends, and Priya's introduction as the wearer
// giving their own name, so nothing is held.

function play(fixture: string, split: (typeof SPLIT_NAMES)[number]) {
  const fx = loadFixture(fixture)
  const clock = new VirtualClock(1)
  const session = new Session({ clock, split: createSplit(split) })
  session.setHearing(true)
  const pcm = new Map<number, Uint8Array>()
  const items = [
    ...framesFor(fx).map((f, seq) => ({ t: f.end, kind: 0, f, seq })),
    ...fx.words.map((wd) => ({ t: wd.end, kind: 1, wd })),
  ].sort((a, b) => a.t - b.t || a.kind - b.kind)
  for (const item of items) {
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
  clock.advance(500)
  return { open: session.conversationOpen, names: session.names.list() }
}

/** After the wearer speaks again: the same conversation still holding Priya, or a new one holding nothing. */
const RIGHT = {
  'quiet-9min': { open: true, names: ['Priya'] },
  'quiet-10min1s': { open: true, names: [] },
}

describe('the conversation boundary under every split, on both fixture variants (two-fixture rule, D127)', () => {
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS) {
      const inverted = split === 'loudness' && variant === 'other-louder'
      for (const [script, right] of Object.entries(RIGHT)) {
        const expected = inverted ? { open: true, names: [] } : right
        it(`${split} on ${script}.${variant} (${inverted ? 'known-inverted' : 'right'})`, () => {
          const { open, names } = play(`${script}.${variant}`, split)
          expect({ open, names }).toEqual(expected)
        })
      }
    }
  }
})
