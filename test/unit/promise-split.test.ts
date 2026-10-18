import { describe, expect, it } from 'vitest'
import { SPLIT_NAMES } from '../../server/src/split/split.ts'
import { modelForTests } from '../harness/model.ts'
import { playIntoSession, promiseLines } from '../harness/session-play.ts'
import { VARIANTS } from '../fixtures/scripts.ts'

// The two-fixture rule (BUILD-PLAN.md, Acceptance bars; D127) for the
// promises, which rest on the split: the wearer's own sentences are the
// wearer's candidates (P2a), everyone else's the owed ones (P5). Each fixture
// goes straight into a session under every split on both variants, with the
// model on the committed cassettes (the end-to-end paths are promises.feature's
// and the others', on the default split and the wearer-louder variant, and
// test/integration/owed-split.test.ts's through the lens under every split).
// The speaker-role and provider-label splits must get both variants right.
// Loudness, the simulator default (D126), must get wearer-louder right and is
// pinned as known-inverted on other-louder: it hears the wearer as someone
// else and someone else as the wearer, so the wearer's promises come back as
// owed to the wearer, from "they" (Dev's own "Hi, I'm Dev" is heard as the
// wearer giving their name, D29, so no name is caught), and Dev's as the
// wearer's.

interface Outcome {
  /** Every promise line the lens was sent, in order: the wearer's (`promised · …`) and the owed (`Dev promised · …`). */
  lines: string[]
  /** What the conversation ended with: the wearer's promises, and those owed to the wearer. */
  you: string[]
  owed: string[]
}

const RIGHT: Record<string, Outcome> = {
  'promise-deck': { lines: ['promised · send Dev the deck tonight'], you: ['send Dev the deck tonight'], owed: [] },
  'promise-sam': { lines: ['promised · introduce Dev to Sam'], you: ['introduce Dev to Sam'], owed: [] },
  'promise-budget': { lines: ['promised · send Dev the budget by Friday'], you: ['send Dev the budget by Friday'], owed: [] },
  'think-about-it': { lines: [], you: [], owed: [] },
  'one-promise': { lines: ['promised · book the room for Thursday'], you: ['book the room for Thursday'], owed: [] },
  // P5: the wearer's two, then Dev's, named by his caught name, the pronoun turned ("Dev sends", never "send Dev").
  handoff: {
    lines: ['promised · send Dev the deck tonight', 'promised · introduce Dev to Sam', 'Dev promised · send the agenda'],
    you: ['send Dev the deck tonight', 'introduce Dev to Sam'],
    owed: ['Dev sends the agenda'],
  },
  'owed-deck': { lines: ['Dev promised · send the deck tonight'], you: [], owed: ['Dev sends the deck tonight'] },
  'owed-agenda': { lines: ['promised · send Dev the deck tonight', 'Dev promised · send the agenda'], you: ['send Dev the deck tonight'], owed: ['Dev sends the agenda'] },
  // D26, D113: unnamed when promised; Dev's name, caught later, attaches to the promiser.
  'owed-unnamed': { lines: ['they promised · send the deck tonight'], you: [], owed: ['Dev sends the deck tonight'] },
  // D113: two unnamed promisers; the name attaches to the most recent only.
  'owed-two': { lines: ['they promised · send the deck tonight', 'they promised · send the slides'], you: [], owed: ['they (1) sends the deck tonight', 'Dev sends the slides'] },
  'newest-wins': { lines: ['Dev promised · send the deck'], you: [], owed: ['Dev sends the deck'] },
}

/**
 * Loudness on other-louder, known-inverted (from the real model's answers on
 * these prompts): the wearer's promises are someone else's, owed to the
 * wearer from an unnamed promiser, and someone else's are the wearer's. In
 * owed-agenda the "wearer's" "I'll send you the agenda" (Dev's) is judged no
 * promise, and in handoff it is the wearer's "send Dev the agenda".
 */
const INVERTED: Record<string, Outcome> = {
  'promise-deck': { lines: ['they promised · send the deck tonight'], you: [], owed: ['they (1) sends the deck tonight'] },
  'promise-sam': { lines: ['they promised · introduce you to Sam'], you: [], owed: ['they (1) introduces you to Sam'] },
  'promise-budget': { lines: ['they promised · send the budget by Friday'], you: [], owed: ['they (1) sends the budget by Friday'] },
  'think-about-it': { lines: [], you: [], owed: [] },
  'one-promise': { lines: ['they promised · book the room for Thursday'], you: [], owed: ['they (1) books the room for Thursday'] },
  handoff: {
    lines: ['they promised · send the deck tonight', 'they promised · introduce you to Sam', 'promised · send Dev the agenda'],
    you: ['send Dev the agenda'],
    owed: ['they (1) sends the deck tonight', 'they (2) introduces you to Sam'],
  },
  'owed-deck': { lines: ['promised · send the deck tonight'], you: ['send the deck tonight'], owed: [] },
  'owed-agenda': { lines: ['they promised · send the deck tonight'], you: [], owed: ['they (1) sends the deck tonight'] },
  'owed-unnamed': { lines: ['promised · send the deck tonight'], you: ['send the deck tonight'], owed: [] },
  'owed-two': { lines: ['promised · send the deck tonight', 'promised · send the slides'], you: ['send the deck tonight', 'send the slides'], owed: [] },
  'newest-wins': { lines: ['promised · send the deck'], you: ['send the deck'], owed: [] },
}

describe('the promises under every split, on both fixture variants (two-fixture rule, D127)', () => {
  const model = modelForTests()
  for (const split of SPLIT_NAMES) {
    for (const variant of VARIANTS) {
      const inverted = split === 'loudness' && variant === 'other-louder'
      for (const [script, right] of Object.entries(RIGHT)) {
        const expected = inverted ? INVERTED[script]! : right
        it(`${split} on ${script}.${variant} (${inverted ? 'known-inverted' : 'right'}): ${JSON.stringify(expected.lines)}`, async () => {
          const play = await playIntoSession(`${script}.${variant}`, split, model)
          expect(play.errors).toEqual([])
          expect(promiseLines(play)).toEqual(expected.lines)
          expect(play.ended.map((e) => [e.promises, e.owed])).toEqual([[expected.you, expected.owed]])
        })
      }
    }
  }
})
