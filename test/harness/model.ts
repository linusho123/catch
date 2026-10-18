import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cassetteKey, liveModel, recordingModel, replayModel, type ModelClient } from '../../server/src/llm/client.ts'

// The model client the harness gives the server: replay from the committed
// cassettes in the lanes; record from the real model only under
// CATCH_REAL_LLM=1, set by hand when a prompt changes.
//
// Recording a slow model through the lanes would cost the scenarios their
// timing (the fixture clock runs twenty times real time, and the jogger model
// takes a minute), so there is a second, offline way (P4): CATCH_LLM_PENDING=1
// keeps replaying, still fails loudly on a missing cassette, and also writes
// the missing prompt under .cache/cassettes-pending/; then
// `node --env-file=.env test/cassettes/rerecord.ts --pending` asks the real
// model each pending prompt and writes its cassette, and the lanes are run
// again until nothing is pending. CATCH_LLM_HITS=<file> appends the key of
// every cassette replayed, so a cassette no test uses can be found and removed.

export const CASSETTE_DIR = resolve(import.meta.dirname, '../cassettes')
export const PENDING_DIR = resolve(import.meta.dirname, '../../.cache/cassettes-pending')

export function modelForTests(dir = CASSETTE_DIR, env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (env.CATCH_REAL_LLM === '1') return recordingModel(dir, liveModel())
  const replay = replayModel(dir)
  if (env.CATCH_LLM_PENDING !== '1' && !env.CATCH_LLM_HITS) return replay
  return {
    async complete(model, prompt, call) {
      const key = cassetteKey(model, prompt)
      const missing = !existsSync(join(dir, `${key}.json`))
      if (missing && env.CATCH_LLM_PENDING === '1') {
        mkdirSync(PENDING_DIR, { recursive: true })
        writeFileSync(join(PENDING_DIR, `${key}.json`), `${JSON.stringify({ cassette: 1, model, prompt }, null, 2)}\n`)
      }
      if (!missing && env.CATCH_LLM_HITS) appendFileSync(env.CATCH_LLM_HITS, `${key}\n`)
      return replay.complete(model, prompt, call)
    },
  }
}
