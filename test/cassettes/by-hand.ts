import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cassetteKey, type ModelClient } from '../../server/src/llm/client.ts'
import { CASSETTE_DIR } from '../harness/model.ts'
import { playIntoSession } from '../harness/session-play.ts'

// The promise cassettes written by hand (P2a): no GEMINI_API_KEY was at hand
// when the promise detector was built, so nothing could be recorded. Each
// fixture below is played into a session on the default split (loudness,
// wearer-louder), and every prompt the session builds for it is answered
// with the answer given here for that sentence, written as a cassette marked
// `"by": "hand"`. The prompts are therefore exactly the server's; the
// answers are the contract's (D89, D90, D47, D117), not a model's. Re-record
// them for real with CATCH_REAL_LLM=1 and GEMINI_API_KEY set once a key is in
// catch/.env, and compare.
//
//   node test/cassettes/by-hand.ts

const yes = (summary: string) => JSON.stringify({ promise: true, summary })
const NO = JSON.stringify({ promise: false })

/** Per fixture, the answer to each candidate sentence of the wearer's. */
export const HAND_ANSWERS: Record<string, Record<string, string>> = {
  'promise-deck.wearer-louder': { "I'll send you the deck tonight.": yes('send Dev the deck tonight') },
  'promise-sam.wearer-louder': { "I'll intro you to Sam.": yes('introduce Dev to Sam') },
  'promise-budget.wearer-louder': { "Yeah, I'll do it.": yes('send Dev the budget by Friday') },
  'think-about-it.wearer-louder': { "I'll think about it.": NO },
  'handoff.wearer-louder': {
    "I'll send you the deck tonight.": yes('send Dev the deck tonight'),
    "I'll intro you to Sam.": yes('introduce Dev to Sam'),
  },
  'long-list.wearer-louder': {
    "I'll send you the deck tonight.": yes('send Dev the deck tonight'),
    "I'll intro you to Sam.": yes('introduce Dev to Sam'),
    "I'll book the room for Thursday.": yes('book the room for Thursday'),
    "I'll email you the budget.": yes('email Dev the budget'),
    "I'll call you on Monday.": yes('call Dev on Monday'),
  },
  'one-promise.wearer-louder': { "I'll book the room for Thursday.": yes('book the room for Thursday') },
  'shared-pair.wearer-louder': {
    "I'll send you the deck tonight.": yes('send Dev the deck tonight'),
    "I'll intro you to Sam.": yes('introduce Dev to Sam'),
  },
  'held-page.wearer-louder': {
    "Dev, I'll send you the deck.": yes('send Dev the deck'),
    "And I'll introduce you to Sam.": yes('introduce Dev to Sam'),
  },
  'quiet-9min.wearer-louder': { "Dev, I'll send you the deck.": yes('send Dev the deck') },
  'quiet-10min1s.wearer-louder': { "Dev, I'll send you the deck.": yes('send Dev the deck') },
  'long-press.wearer-louder': { "Dev, I'll send you the deck tonight.": yes('send Dev the deck tonight') },
}

/** The sentence a prompt judges: its "The wearer now says:" line. */
export const utteranceOf = (prompt: string) => /^The wearer now says: (.*)$/m.exec(prompt)?.[1]

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [fixture, answers] of Object.entries(HAND_ANSWERS)) {
    const asked = new Set<string>()
    const model: ModelClient = {
      async complete(model, prompt) {
        const said = utteranceOf(prompt)!
        const response = answers[said]
        if (response === undefined) throw new Error(`${fixture}: no hand answer for ${JSON.stringify(said)}`)
        asked.add(said)
        writeFileSync(join(CASSETTE_DIR, `${cassetteKey(model, prompt)}.json`), `${JSON.stringify({ cassette: 1, by: 'hand', model, prompt, response }, null, 2)}\n`)
        return response
      },
    }
    const { errors } = await playIntoSession(fixture, 'loudness', model)
    if (errors.length > 0) throw errors[0]
    const unasked = Object.keys(answers).filter((s) => !asked.has(s))
    if (unasked.length > 0) throw new Error(`${fixture}: the session never asked about ${JSON.stringify(unasked)}`)
    console.log(`${fixture}: ${asked.size} cassette(s)`)
  }
}
