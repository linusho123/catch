import { resolve } from 'node:path'
import { liveModel, recordingModel, replayModel, type ModelClient } from '../../server/src/llm/client.ts'

// The model client the harness gives the server: replay from the committed
// cassettes in the lanes; record from the real model only under
// CATCH_REAL_LLM=1, set by hand when a prompt changes.

export const CASSETTE_DIR = resolve(import.meta.dirname, '../cassettes')

export function modelForTests(dir = CASSETTE_DIR, env: NodeJS.ProcessEnv = process.env): ModelClient {
  return env.CATCH_REAL_LLM === '1' ? recordingModel(dir, liveModel()) : replayModel(dir)
}
