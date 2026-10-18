import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateText, type GeminiModel, type GeminiOptions } from './gemini.ts'

// The model client: the one function the promise detector, the introduction
// detector's model fallback and the jogger writer call. Live in production;
// under test it replays committed cassettes (test/cassettes/), keyed by a hash
// of the model id and the prompt, and never reaches the network. A missing
// cassette fails loudly; CATCH_REAL_LLM=1 records one by hand.

/** One call's options: `signal` cancels it (the request itself, live; risk-2). */
export interface CallOptions {
  signal?: AbortSignal
}

export interface ModelClient {
  complete(model: GeminiModel, prompt: string, call?: CallOptions): Promise<string>
}

export interface Cassette {
  cassette: 1
  model: GeminiModel
  prompt: string
  response: string
}

export function liveModel(opts: GeminiOptions = {}): ModelClient {
  return { complete: (model, prompt, call) => generateText(model, prompt, { ...opts, ...(call?.signal ? { signal: call.signal } : {}) }) }
}

export function cassetteKey(model: GeminiModel, prompt: string): string {
  return createHash('sha256').update(`${model}\n${prompt}`).digest('hex').slice(0, 32)
}

/** Answers only from cassettes in `dir`; a prompt with none is an error, never a network call. */
export function replayModel(dir: string): ModelClient {
  return {
    async complete(model, prompt) {
      const path = join(dir, `${cassetteKey(model, prompt)}.json`)
      if (!existsSync(path)) {
        throw new Error(
          `no cassette for this ${model} prompt (${path}); record it by hand with CATCH_REAL_LLM=1 and commit it. Prompt: ${JSON.stringify(prompt.slice(0, 200))}`,
        )
      }
      const tape = JSON.parse(readFileSync(path, 'utf8')) as Cassette
      if (tape.model !== model || tape.prompt !== prompt) throw new Error(`cassette ${path} does not hold this prompt`)
      return tape.response
    },
  }
}

/** Calls `live` and writes each answer to `dir` as a cassette. Only behind CATCH_REAL_LLM=1. */
export function recordingModel(dir: string, live: ModelClient): ModelClient {
  return {
    async complete(model, prompt, call) {
      const response = await live.complete(model, prompt, call)
      const tape: Cassette = { cassette: 1, model, prompt, response }
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${cassetteKey(model, prompt)}.json`), `${JSON.stringify(tape, null, 2)}\n`)
      return response
    },
  }
}
