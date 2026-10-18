import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveModel, type Cassette, type ModelClient } from '../../server/src/llm/client.ts'
import { SafeModelError } from '../../server/src/llm/errors.ts'
import { CASSETTE_DIR, PENDING_DIR } from '../harness/model.ts'

// Re-records committed cassettes from the real model, each from the very
// prompt it holds, so its key (the model and the prompt) is unchanged and only
// the answer becomes the model's. By default only the cassettes written by
// hand (`"by": "hand"`, the P2a cassettes before a key was at hand); `--all`
// re-records every one; file names (or key prefixes) given as arguments
// re-record just those. `--pending` instead records each prompt a lane run
// under CATCH_LLM_PENDING=1 found missing (test/harness/model.ts), and
// removes it from the pending list. A free-tier refusal (429) waits and tries
// again. Needs GEMINI_API_KEY (catch/.env):
//
//   node --env-file=.env test/cassettes/rerecord.ts [--all | --pending] [key ...]
//
// Then run the lanes: an answer that breaks a scenario is fixed in the prompt
// or the code, never in the scenario (and a changed prompt is re-recorded
// with CATCH_REAL_LLM=1). The key is never printed.

type Tape = Cassette & { by?: string }

const args = process.argv.slice(2)
const all = args.includes('--all')
const pending = args.includes('--pending')
const only = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\.json$/, ''))
const live = liveModel()

/** Worth another try: the free tier's rate limit (429), the model's "high demand" (503), or a request that timed out. */
const transient = (error: unknown) =>
  (error instanceof SafeModelError && (error.message.endsWith(' 429') || error.message.endsWith(' 503'))) || (error instanceof TypeError && error.message === 'fetch failed')

/** The live model, waiting out a transient refusal a few times before giving up. */
const model: ModelClient = {
  async complete(m, prompt) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await live.complete(m, prompt)
      } catch (error) {
        if (!transient(error) || attempt === 8) throw error
        const why = error instanceof SafeModelError ? error.message.slice(-3) : 'timed out'
        console.log(`  ${m} refused (${why}), waiting ${attempt * 20} s`)
        await new Promise((r) => setTimeout(r, attempt * 20_000))
      }
    }
  },
}

if (pending) {
  const files = (existsSync(PENDING_DIR) ? readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json')).sort() : []).filter(
    (f) => only.length === 0 || only.some((k) => f.startsWith(k)),
  )
  for (const file of files) {
    const { model: m, prompt } = JSON.parse(readFileSync(join(PENDING_DIR, file), 'utf8')) as Cassette
    const started = performance.now()
    const response = await model.complete(m, prompt)
    writeFileSync(join(CASSETTE_DIR, file), `${JSON.stringify({ cassette: 1, model: m, prompt, response } satisfies Cassette, null, 2)}\n`)
    rmSync(join(PENDING_DIR, file))
    console.log(`${file} (${m}, ${Math.round((performance.now() - started) / 1000)} s): ${response}`)
  }
  console.log(`${files.length} pending prompt(s) recorded`)
  process.exit(0)
}

for (const file of readdirSync(CASSETTE_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(CASSETTE_DIR, file)
  const tape = JSON.parse(readFileSync(path, 'utf8')) as Tape
  const chosen = only.length > 0 ? only.some((k) => file.startsWith(k)) : all || tape.by === 'hand'
  if (!chosen) continue
  const before = tape.response
  const response = await model.complete(tape.model, tape.prompt)
  const { by: _by, ...rest } = tape
  writeFileSync(path, `${JSON.stringify({ ...rest, response } satisfies Cassette, null, 2)}\n`)
  console.log(`${file}: ${before === response ? 'same answer' : `was ${before}\n  now ${response}`}`)
}
