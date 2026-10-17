// The Gemini API adapter (DESIGN.md: chosen). Two pinned model ids and nothing
// else: never a gemini-2.5-* id (retiring) and never a -preview id. The key is
// GEMINI_API_KEY. P0b wraps this in the record-and-replay client; no test may
// reach the network through it.

export const PROMISE_MODEL = 'gemini-3.5-flash-lite'
export const JOGGER_MODEL = 'gemini-3.8-flash'

export type GeminiModel = typeof PROMISE_MODEL | typeof JOGGER_MODEL

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiOptions {
  apiKey?: string
  fetch?: typeof fetch
}

export async function generateText(model: GeminiModel, prompt: string, opts: GeminiOptions = {}): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const doFetch = opts.fetch ?? fetch
  const res = await doFetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  })
  if (!res.ok) throw new Error(`Gemini ${model} answered ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (text === undefined) throw new Error(`Gemini ${model} returned no candidate text`)
  return text
}
