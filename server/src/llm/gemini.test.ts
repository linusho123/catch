import { describe, expect, it } from 'vitest'
import { generateText, JOGGER_MODEL, PROMISE_MODEL } from './gemini.ts'

describe('the Gemini adapter', () => {
  it('pins the two chosen model ids, neither retiring nor preview', () => {
    expect(PROMISE_MODEL).toBe('gemini-3.5-flash-lite')
    expect(JOGGER_MODEL).toBe('gemini-3.8-flash')
    for (const id of [PROMISE_MODEL, JOGGER_MODEL]) {
      expect(id).not.toMatch(/^gemini-2\.5-/)
      expect(id).not.toMatch(/preview/)
    }
  })

  it('posts the prompt to the pinned model with the key in a header, and returns the text', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'yes' }, { text: '.' }] } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const text = await generateText(PROMISE_MODEL, 'is this a promise?', { apiKey: 'k', fetch: fakeFetch })
    expect(text).toBe('yes.')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ contents: [{ role: 'user', parts: [{ text: 'is this a promise?' }] }] })
  })

  it('fails loudly on a missing key and on an error status', async () => {
    const saved = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      await expect(generateText(JOGGER_MODEL, 'p')).rejects.toThrow(/GEMINI_API_KEY/)
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved
    }
    const failing = (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch
    await expect(generateText(JOGGER_MODEL, 'p', { apiKey: 'k', fetch: failing })).rejects.toThrow(/429/)
  })

  // Fix round, risk-2: a pass the session gives up on cancels its request, rather than leaving it to undici's own timeouts.
  it('cancels the request itself when the signal aborts (risk-2)', async () => {
    const abort = new AbortController()
    let seen: AbortSignal | undefined
    const hanging = ((_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    }) as unknown as typeof fetch
    const call = generateText(PROMISE_MODEL, 'p', { apiKey: 'k', fetch: hanging, signal: abort.signal })
    expect(seen, 'the request carries the signal').toBe(abort.signal)
    abort.abort()
    await expect(call).rejects.toThrow()
  })
})
