import { describe, expect, it } from 'vitest'
import { SPLIT_NAMES } from '../../server/src/split/split.ts'
import { modelForTests } from '../harness/model.ts'
import { playIntoSession, promiseLines } from '../harness/session-play.ts'
import { VARIANTS } from '../fixtures/scripts.ts'

// The two-fixture rule (BUILD-PLAN.md, Acceptance bars; D127) for P2a's
// promises, which rest on the split: only the wearer's own sentences are
// candidates. Each fixture goes straight into a session under every split on
// both variants, with the model on the committed cassettes (the end-to-end
// path is promises.feature's, on the default split and the wearer-louder
// variant). The speaker-role and provider-label splits must get both variants
// right. Loudness, the simulator default (D126), must get wearer-louder right
// and is pinned as known-inverted on other-louder: the wearer's promises are
// heard as someone else's, so nothing is promised and nothing shows (and the
// louder other person's lines, which carry no commitment, cost no model pass).

const RIGHT: Record<string, string[]> = {
  'promise-deck': ['send Dev the deck tonight'],
  'promise-sam': ['introduce Dev to Sam'],
  'promise-budget': ['send Dev the budget by Friday'],
  'think-about-it': [],
  'one-promise': ['book the room for Thursday'],
  // The wearer's two; Dev's "I'll send you the agenda" is P5's.
  handoff: ['send Dev the deck tonight', 'introduce Dev to Sam'],
}

/** Fixtures whose other person also says "I'll …": under the inverted split those would be the wearer's, with no cassette. */
const OTHER_PROMISES = new Set(['handoff'])

describe("the wearer's promises under every split, on both fixture variants (two-fixture rule, D127)", () => {
  const model = modelForTests()
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS) {
      const inverted = split === 'loudness' && variant === 'other-louder'
      for (const [script, right] of Object.entries(RIGHT)) {
        if (inverted && OTHER_PROMISES.has(script)) continue
        const expected = inverted ? [] : right
        it(`${split} on ${script}.${variant} (${inverted ? 'known-inverted' : 'right'}): ${JSON.stringify(expected)}`, async () => {
          const play = await playIntoSession(`${script}.${variant}`, split, model)
          expect(play.errors).toEqual([])
          expect(promiseLines(play)).toEqual(expected.map((s) => `promised · ${s}`))
          expect(play.ended.map((e) => e.promises)).toEqual([expected])
        })
      }
    }
  }
})
