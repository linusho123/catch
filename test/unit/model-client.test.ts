import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cassetteKey, recordingModel, replayModel, type ModelClient } from '../../server/src/llm/client.ts'
import { JOGGER_MODEL, PROMISE_MODEL, type GeminiModel } from '../../server/src/llm/gemini.ts'
import { CASSETTE_DIR, modelForTests } from '../harness/model.ts'

// The model client on cassettes: replay in the lanes, a missing cassette is a
// loud failure and never a network call, and CATCH_REAL_LLM=1 records.

const dir = () => mkdtempSync(join(tmpdir(), 'catch-cassettes-'))
/** A model id other than the pinned one (both pinned ids are flash-lite since P4's fix round): the key and the check must tell them apart. */
const ANOTHER_MODEL = 'gemini-3.8-flash' as unknown as GeminiModel
afterEach(() => vi.restoreAllMocks())

describe('the model client, record and replay', () => {
  it('replays a cassette keyed by the model and the prompt', async () => {
    const d = dir()
    const prompt = 'Is "I\'ll send you the deck tonight" a promise?'
    writeFileSync(join(d, `${cassetteKey(PROMISE_MODEL, prompt)}.json`), JSON.stringify({ cassette: 1, model: PROMISE_MODEL, prompt, response: 'yes' }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await replayModel(d).complete(PROMISE_MODEL, prompt)).toBe('yes')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(cassetteKey(ANOTHER_MODEL, prompt)).not.toBe(cassetteKey(PROMISE_MODEL, prompt))
  })

  it('fails loudly on a missing cassette, naming the prompt and how to record it, without calling out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(replayModel(dir()).complete(PROMISE_MODEL, 'never recorded')).rejects.toThrow(/no cassette.*CATCH_REAL_LLM=1.*never recorded/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a cassette whose prompt is not the one asked', async () => {
    const d = dir()
    writeFileSync(join(d, `${cassetteKey(PROMISE_MODEL, 'a')}.json`), JSON.stringify({ cassette: 1, model: PROMISE_MODEL, prompt: 'b', response: 'x' }))
    await expect(replayModel(d).complete(PROMISE_MODEL, 'a')).rejects.toThrow(/does not hold this prompt/)
  })

  it('refuses a cassette whose model is not the one asked, even with the prompt asked (M5)', async () => {
    const d = dir()
    writeFileSync(join(d, `${cassetteKey(PROMISE_MODEL, 'a')}.json`), JSON.stringify({ cassette: 1, model: ANOTHER_MODEL, prompt: 'a', response: 'x' }))
    await expect(replayModel(d).complete(PROMISE_MODEL, 'a')).rejects.toThrow(/does not hold this prompt/)
  })

  it('records what the live model answers, and replay then answers it', async () => {
    const d = dir()
    const live: ModelClient = { complete: async (_m, p) => `answer to ${p}` }
    expect(await recordingModel(d, live).complete(JOGGER_MODEL, 'write the jogger')).toBe('answer to write the jogger')
    expect(readdirSync(d)).toEqual([`${cassetteKey(JOGGER_MODEL, 'write the jogger')}.json`])
    expect(await replayModel(d).complete(JOGGER_MODEL, 'write the jogger')).toBe('answer to write the jogger')
  })

  it('replays from test/cassettes in the lanes and records only under CATCH_REAL_LLM=1', async () => {
    await expect(modelForTests(CASSETTE_DIR, {}).complete(PROMISE_MODEL, 'no such prompt')).rejects.toThrow(/no cassette/)
    const d = dir()
    const recording = modelForTests(d, { CATCH_REAL_LLM: '1' })
    // Recording calls the live adapter, which needs the key: proof it is not the replay client.
    const saved = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      await expect(recording.complete(PROMISE_MODEL, 'p')).rejects.toThrow(/GEMINI_API_KEY/)
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved
    }
  })
})
