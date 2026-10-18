import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../llm/client.ts'
import { JOGGER_MODEL } from '../llm/gemini.ts'
import { honestBold, JoggerPassError, joggerLines, joggerPrompt, notHeard, parseJogger, writeJogger } from './jogger.ts'
import type { TranscriptWord } from './transcript.ts'

// The jogger writer (P4) on its own, with a model that answers what the test
// gives it: the transcript as numbered lines, the model's bullets put in the
// order things came up, the wearer's promises and the missed time placed by
// the code (D53, D99), and no bold on a term nobody said.

function words(lines: [side: 'wearer' | 'other', text: string, start: number][]): TranscriptWord[] {
  return lines.flatMap(([side, text, start]) => text.split(' ').map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.3, side })))
}

const CALL = words([
  ['wearer', 'Hi, thanks for taking the call.', 0],
  ['other', "Hi, I'm Ana.", 3],
  ['other', 'My lab designs proteins with diffusion models.', 60],
  ['wearer', 'How do you validate the designs?', 90],
  ['other', 'We screen them with AlphaFold.', 92],
  ['wearer', "I'll send you my transcript by Friday.", 1180],
])

/** A model that records the prompt and answers `response`. */
function answering(response: string) {
  const asked: { model: string; prompt: string }[] = []
  const model: ModelClient = {
    complete: (m, prompt) => {
      asked.push({ model: m, prompt })
      return Promise.resolve(response)
    },
  }
  return { model, asked }
}

describe('the transcript as the model reads it', () => {
  it('is one line per sentence or per turn, numbered from one, each marked Wearer or Other', () => {
    const lines = joggerLines(CALL)
    expect(lines.map((l) => [l.side, l.text])).toEqual([
      ['wearer', 'Hi, thanks for taking the call.'],
      ['other', "Hi, I'm Ana."],
      ['other', 'My lab designs proteins with diffusion models.'],
      ['wearer', 'How do you validate the designs?'],
      ['other', 'We screen them with AlphaFold.'],
      ['wearer', "I'll send you my transcript by Friday."],
    ])
    const prompt = joggerPrompt(lines, ['Ana'], [6])
    expect(prompt).toContain('1 Wearer: Hi, thanks for taking the call.\n2 Other: Hi, I\'m Ana.')
    expect(prompt).toContain('Names caught in this conversation, in the order heard: Ana')
    expect(prompt).toContain("Line 6 is the wearer's own promise")
    expect(prompt, 'no clock time reaches the model').not.toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('D53: the missed time', () => {
  it('says how long in whole minutes, never when, and nothing for under half a minute', () => {
    expect(notHeard(240_000)).toBe('4 minutes not heard')
    expect(notHeard(241_000)).toBe('4 minutes not heard')
    expect(notHeard(60_000)).toBe('1 minute not heard')
    expect(notHeard(20_000)).toBeUndefined()
  })
})

describe('honest bold', () => {
  it('keeps the bold on a term the transcript has, word for word or in another case, and takes it off one it does not', () => {
    const heard = 'My lab designs proteins with diffusion models. We screen them with AlphaFold.'
    expect(honestBold('Designs with **diffusion models**, screened by **alphafold**.', heard)).toBe('Designs with **diffusion models**, screened by **alphafold**.')
    expect(honestBold('Uses **transformers** too.', heard)).toBe('Uses transformers too.')
    expect(honestBold('A **diffusion model** lab.', heard), 'not the same words').toBe('A diffusion model lab.')
  })

  // Fix round, risk-3: a symbol that is part of a term is part of what must have been said, and a term never runs across a sentence's end.
  it('takes the bold off C# and C++ when only the letter was said, and off a term heard only across a sentence end', () => {
    expect(honestBold('Uses **C#** and **C++** and **learning rate**', 'we like c. the learning. rate was fine')).toBe('Uses C# and C++ and learning rate')
    expect(honestBold('Uses **C#** and **C++** and **learning rate**', 'we write C# and C++. the learning rate was fine')).toBe('Uses **C#** and **C++** and **learning rate**')
    expect(honestBold('Tuned the **learning rate**', 'we tuned the learning\nrate later'), 'a line break is a sentence end too').toBe('Tuned the learning rate')
  })
})

describe("the model's answer", () => {
  it('is bullets each with a transcript line; anything else is an error that never quotes the answer', () => {
    expect(parseJogger('```json\n{"bullets":[{"line":2,"text":"  Ana\\nruns a lab "}]}\n```', 3)).toEqual([{ line: 2, text: 'Ana runs a lab' }])
    for (const bad of ['Ana runs a lab', '{"bullets":"Ana"}', '{"bullets":[{"line":4,"text":"Ana"}]}', '{"bullets":[{"line":1,"text":" "}]}', '{"bullets":[{"text":"Ana"}]}']) {
      expect(() => parseJogger(bad, 3)).toThrow(JoggerPassError)
      try {
        parseJogger(bad, 3)
      } catch (e) {
        expect((e as Error).message).not.toContain('Ana')
      }
    }
  })
})

describe('writing a jogger', () => {
  it('puts the bullets in the order things came up, the promise at its line, and the missed time where it fell', async () => {
    const { model, asked } = answering(
      JSON.stringify({
        bullets: [
          { line: 5, text: 'Designs are screened with **AlphaFold**.' },
          { line: 3, text: 'Her lab designs proteins with **diffusion models**.' },
          { line: 4, text: 'You asked how designs are validated.' },
        ],
      }),
    )
    const jogger = await writeJogger(model, {
      names: ['Ana'],
      transcript: CALL,
      promises: ['send Ana the transcript by Friday'],
      promiseTimes: [CALL.at(-1)!.end],
      gaps: [{ at: 70, ms: 240_000 }],
    })
    expect(asked.map((a) => a.model)).toEqual([JOGGER_MODEL])
    expect(jogger.bullets).toEqual([
      'Her lab designs proteins with **diffusion models**.',
      '4 minutes not heard',
      'You asked how designs are validated.',
      'Designs are screened with **AlphaFold**.',
      'You promised: send Ana the transcript by Friday',
    ])
  })

  // Fix round, head-1: a promise said before something else came up sits at its own line, not at the end (D99).
  it('puts a promise said mid-conversation between what came up before it and what came up after', async () => {
    const MID = words([
      ['other', "Hi, I'm Ana.", 0],
      ['other', 'My lab designs proteins with diffusion models.', 5],
      ['wearer', "I'll send you my transcript by Friday.", 10],
      ['other', 'We screen them with AlphaFold.', 15],
    ])
    const { model } = answering(
      JSON.stringify({
        bullets: [
          { line: 4, text: 'Designs are screened with **AlphaFold**.' },
          { line: 2, text: 'Her lab designs proteins with **diffusion models**.' },
        ],
      }),
    )
    const promiseEnd = MID.find((w) => w.text === 'Friday.')!.end
    const jogger = await writeJogger(model, { names: ['Ana'], transcript: MID, promises: ['send Ana my transcript by Friday'], promiseTimes: [promiseEnd], gaps: [] })
    expect(jogger.bullets).toEqual([
      'Her lab designs proteins with **diffusion models**.',
      'You promised: send Ana my transcript by Friday',
      'Designs are screened with **AlphaFold**.',
    ])
  })

  it('caps nothing: every bullet the model writes is kept', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ line: 1 + (i % 6), text: `Point ${i}` }))
    const jogger = await writeJogger(answering(JSON.stringify({ bullets: many })).model, { names: [], transcript: CALL, promises: [], promiseTimes: [], gaps: [] })
    expect(jogger.bullets).toHaveLength(40)
  })

  it('asks no model when nothing was heard, and still says what was missed', async () => {
    const { model, asked } = answering('{}')
    const jogger = await writeJogger(model, { names: [], transcript: [], promises: [], promiseTimes: [], gaps: [{ at: 0, ms: 300_000 }] })
    expect(asked).toEqual([])
    expect(jogger.bullets).toEqual(['5 minutes not heard'])
  })
})
