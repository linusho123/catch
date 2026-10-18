import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../../test/harness/clock.ts'
import type { ModelClient } from '../llm/client.ts'
import { JOGGER_MODEL } from '../llm/gemini.ts'
import {
  honestBold,
  joggerBudgetMs,
  JOGGER_BUDGET_MS,
  JOGGER_LONG_BUDGET_MS,
  JoggerPassError,
  joggerLines,
  joggerPrompt,
  notHeard,
  parseJogger,
  parseTidy,
  tidyPrompt,
  tidyRejection,
  writeJogger,
  writeKeptJogger,
  type TidyOutcome,
} from './jogger.ts'
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

// P7: the tidy pass (the operator's `chosen` change), a second call grounded on
// the transcript, checked for D99's structure, and sharing D116's thirty
// seconds with the first pass; a tidy that fails, is late or breaks the
// structure leaves the first draft as it is.
describe('the tidy pass', () => {
  const DRAFT_ANSWER = JSON.stringify({
    bullets: [
      { line: 3, text: 'Her lab designs proteins with **diffusion models**.' },
      { line: 3, text: 'The lab, uh, works on protein design.' },
      { line: 4, text: 'You asked how designs are validated.' },
      { line: 5, text: 'Designs are screened with **AlphaFold**.' },
    ],
  })
  const INPUT = { names: ['Ana'], transcript: CALL, promises: ['send Ana the transcript by Friday'], promiseTimes: [CALL.at(-1)!.end], gaps: [{ at: 70, ms: 240_000 }] }
  const FIRST = [
    'Her lab designs proteins with **diffusion models**.',
    'The lab, uh, works on protein design.',
    '4 minutes not heard',
    'You asked how designs are validated.',
    'Designs are screened with **AlphaFold**.',
    'You promised: send Ana the transcript by Friday',
  ]
  const TIDIED = [
    'Her lab designs proteins with **diffusion models**.',
    '4 minutes not heard',
    'You asked how the designs are validated: they are screened with **AlphaFold**.',
    'You promised: send Ana the transcript by Friday',
  ]

  /** A model that answers the first pass with `draft` and the tidy pass with `tidy`, recording each prompt. */
  function twoPasses(tidy: (prompt: string) => Promise<string>, draft = DRAFT_ANSWER, onDraft?: () => void) {
    const asked: { model: string; prompt: string }[] = []
    const model: ModelClient = {
      complete: (m, prompt) => {
        asked.push({ model: m, prompt })
        if (asked.length === 1) {
          onDraft?.()
          return Promise.resolve(draft)
        }
        return tidy(prompt)
      },
    }
    return { model, asked }
  }
  const answer = (bullets: string[]) => () => Promise.resolve(JSON.stringify({ bullets }))

  async function kept(model: ModelClient, clock = new VirtualClock(1e-6)) {
    const outcomes: TidyOutcome[] = []
    const jogger = await writeKeptJogger(model, INPUT, { clock, conversationMs: 25 * 60_000, onTidy: (o) => outcomes.push(o) })
    return { jogger, outcomes }
  }

  it('asks the same model a second time, grounded on the transcript, with the draft and the bullets to copy, and stores its answer', async () => {
    const { model, asked } = twoPasses(answer(TIDIED))
    const { jogger, outcomes } = await kept(model)
    expect(asked.map((a) => a.model)).toEqual([JOGGER_MODEL, JOGGER_MODEL])
    const prompt = asked[1]!.prompt
    expect(prompt).toContain('3 Other: My lab designs proteins with diffusion models.')
    expect(prompt).toContain('2. The lab, uh, works on protein design.')
    expect(prompt, 'the code-placed bullets, in their order, to copy as they are').toContain(
      'never merge, reword, move or drop them:\n  4 minutes not heard\n  You promised: send Ana the transcript by Friday\nAnswer with JSON only',
    )
    expect(prompt).toContain('never add a term, a fact, a number or a name it does not contain')
    expect(prompt, 'no clock time reaches the model').not.toMatch(/\d{1,2}:\d{2}/)
    expect(tidyPrompt(joggerLines(CALL), { bullets: FIRST, fixed: [] })).not.toContain('Copy each of these bullets')
    expect(jogger.bullets).toEqual(TIDIED)
    expect(outcomes).toEqual([{ tidied: true }])
  })

  it('takes the bold off a term the tidy pass set in bold that nobody said', async () => {
    const { model } = twoPasses(answer([TIDIED[0]!, TIDIED[1]!, 'Designs are screened with **AlphaFold** as **screening tools**.', TIDIED[3]!]))
    const { jogger, outcomes } = await kept(model)
    expect(outcomes).toEqual([{ tidied: true }])
    expect(jogger.bullets[2]).toBe('Designs are screened with **AlphaFold** as screening tools.')
  })

  it('keeps the first draft when the tidied one breaks the structure', async () => {
    const promise = 'You promised: send Ana the transcript by Friday'
    const broken: [string, string[]][] = [
      ['a promise lost', TIDIED.slice(0, 3)],
      ['a promise reworded', [...TIDIED.slice(0, 3), 'You promised: send Ana the transcript']],
      ['a promise doubled', [...TIDIED, promise]],
      ['the gap line lost', [TIDIED[0]!, TIDIED[2]!, promise]],
      ['the gap line moved', [TIDIED[0]!, TIDIED[2]!, '4 minutes not heard', promise]],
      ['a gap line invented', [TIDIED[0]!, '2 minutes not heard', ...TIDIED.slice(1)]],
      ['a bold term lost', [TIDIED[0]!, TIDIED[1]!, 'You asked how the designs are validated: screened with AlphaFold.', promise]],
      ['bold terms out of order', ['Screened with **AlphaFold**.', TIDIED[1]!, 'Designs with **diffusion models**.', promise]],
      ['a heading', ['Protein design:', ...TIDIED]],
      ['more bullets than the draft', [...FIRST, 'Ana leads the lab.']],
      ['a name nobody said', [TIDIED[0]!, TIDIED[1]!, 'Validated with **AlphaFold**, as Marcus suggested.', promise]],
      ['a number nobody said', [TIDIED[0]!, TIDIED[1]!, 'Validated with **AlphaFold** on 300 designs.', promise]],
      ['a long bullet', [TIDIED[0]!, TIDIED[1]!, `Validated with **AlphaFold** ${'and then '.repeat(12)}done.`, promise]],
      ['no bullets', []],
      // risk-1: a bullet's first word is a name or a number like any other.
      ['an invented name opening a bullet', ['Zorblax designs proteins with **diffusion models**.', TIDIED[1]!, TIDIED[2]!, promise]],
      ['an invented number opening a bullet', ['300 proteins are designed with **diffusion models**.', TIDIED[1]!, TIDIED[2]!, promise]],
    ]
    for (const [what, bullets] of broken) {
      const { model } = twoPasses(answer(bullets))
      const { jogger, outcomes } = await kept(model)
      expect(jogger.bullets, what).toEqual(FIRST)
      expect(outcomes.map((o) => (o.tidied ? 'tidied' : o.why)), what).toEqual(['rejected'])
    }
  })

  it("lets a bullet open with a name or a word the transcript or the draft has, a name's possessive too (risk-1)", () => {
    const draft = { bullets: FIRST, fixed: [FIRST[2]!, FIRST[5]!] }
    const transcript = joggerLines(CALL).map((l) => l.text).join('\n')
    const promise = FIRST[5]!
    expect(tidyRejection(draft, ["Ana's lab designs proteins with **diffusion models**.", FIRST[2]!, TIDIED[2]!, promise], transcript)).toBeUndefined()
    expect(tidyRejection(draft, ['Designs come from **diffusion models**.', FIRST[2]!, TIDIED[2]!, promise], transcript)).toBeUndefined()
    expect(tidyRejection(draft, ["Zorblax's lab designs proteins with **diffusion models**.", FIRST[2]!, TIDIED[2]!, promise], transcript)).toBeDefined()
  })

  // risk-2: a promise or the missed time stays at its place among the plain bullets, which the bold terms alone do not pin.
  it('keeps the first draft when a promise or the missed time moves among the plain bullets, and allows merges around them', async () => {
    const PLAIN = JSON.stringify({
      bullets: [
        { line: 3, text: 'Her lab designs proteins.' },
        { line: 4, text: 'You asked how designs are validated.' },
        { line: 5, text: 'They screen them.' },
      ],
    })
    const asked = CALL.find((w) => w.text === 'designs?')!.end
    const modelsEnd = CALL.find((w) => w.text === 'models.')!.end
    const promise = 'You promised: send Ana the transcript by Friday'
    const plain = (gap: boolean) => ({ ...INPUT, promiseTimes: [asked], gaps: gap ? [{ at: modelsEnd, ms: 240_000 }] : [] })
    const lab = 'Her lab designs proteins.'
    const ask = 'You asked how designs are validated.'
    const screen = 'They screen them.'
    const merged = 'You asked how designs are validated: they screen them.'
    const gapLine = '4 minutes not heard'
    const cases: [what: string, gap: boolean, tidied: string[], kept: boolean][] = [
      ['a promise moved to the end', false, [lab, ask, screen, promise], false],
      ['a promise moved before an earlier point', false, [promise, lab, ask, screen], false],
      ['a promise moved ahead of a merged bullet', false, [promise, 'Her lab designs proteins and screens them.'], false],
      ['the gap line and the promise moved to the end', true, [lab, ask, screen, gapLine, promise], false],
      ['the gap line and the promise moved before an earlier point', true, [gapLine, promise, lab, merged], false],
      ['a point moved in between the gap line and the promise', true, [lab, gapLine, ask, promise, screen], false],
      ['bullets merged after the promise', false, [lab, promise, merged], true],
      ['bullets merged after the gap line and the promise', true, [lab, gapLine, promise, merged], true],
    ]
    for (const [what, gap, tidied, kept] of cases) {
      const { model } = twoPasses(answer(tidied), PLAIN)
      const outcomes: TidyOutcome[] = []
      const jogger = await writeKeptJogger(model, plain(gap), { clock: new VirtualClock(1e-6), conversationMs: 25 * 60_000, onTidy: (o) => outcomes.push(o) })
      const first = gap ? [lab, gapLine, promise, ask, screen] : [lab, promise, ask, screen]
      expect(jogger.bullets, what).toEqual(kept ? tidied : first)
      expect(outcomes.map((o) => (o.tidied ? 'tidied' : o.why)), what).toEqual([kept ? 'tidied' : 'rejected'])
    }
  })

  // head-probe-T6: a time of day the number rule lets through (the transcript says it) is still refused.
  it('keeps the first draft when the tidied one says when something was said, even a time the transcript has', async () => {
    const transcript = words([
      ['other', 'The demo starts at 10:30 in Hall B.', 0],
      ['wearer', 'Great, see you there.', 5],
    ])
    const draft = JSON.stringify({ bullets: [{ line: 1, text: 'The demo is in Hall B.' }] })
    for (const tidied of ['The demo starts at 10:30 in Hall B.', '10:30 is when the demo starts in Hall B.']) {
      const { model } = twoPasses(answer([tidied]), draft)
      const outcomes: TidyOutcome[] = []
      const jogger = await writeKeptJogger(model, { names: [], transcript, promises: [], promiseTimes: [], gaps: [] }, { clock: new VirtualClock(1e-6), conversationMs: 60_000, onTidy: (o) => outcomes.push(o) })
      expect(jogger.bullets, tidied).toEqual(['The demo is in Hall B.'])
      expect(outcomes, tidied).toEqual([{ tidied: false, why: 'rejected', reason: 'it says when something was said' }])
    }
  })

  it('names only the rule it broke, never a word of the conversation', () => {
    const reason = tidyRejection({ bullets: FIRST, fixed: [FIRST[2]!, FIRST[5]!] }, TIDIED.slice(0, 3), 'transcript')
    expect(reason).toBeDefined()
    for (const word of ['Ana', 'Friday', 'AlphaFold', 'diffusion']) expect(reason).not.toContain(word)
    expect(() => parseTidy('Ana runs a lab')).toThrow(JoggerPassError)
    expect(() => parseTidy('{"bullets":[" "]}')).toThrow(JoggerPassError)
    expect(parseTidy('```json\n{"bullets":["  Ana\\nruns a lab "]}\n```')).toEqual(['Ana runs a lab'])
  })

  it('keeps the first draft when the tidy pass fails or answers malformed', async () => {
    for (const tidy of [() => Promise.reject(new JoggerPassError('Gemini answered 503')), () => Promise.resolve('no json here')]) {
      const { model } = twoPasses(tidy)
      const { jogger, outcomes } = await kept(model)
      expect(jogger.bullets).toEqual(FIRST)
      expect(outcomes.map((o) => (o.tidied ? 'tidied' : o.why))).toEqual(['failed'])
    }
  })

  it('shares the thirty seconds: a tidy pass still out when they run out is dropped, and one answering a millisecond before them is kept', async () => {
    // A near-frozen clock: only `advance` moves it. The first pass takes 29,990 ms.
    for (const [extra, expected] of [
      [9, TIDIED],
      [10, FIRST],
    ] as const) {
      const clock = new VirtualClock(1e-9)
      let release!: () => void
      const tidyAsked = new Promise<void>((r) => (release = r))
      const { model, asked } = twoPasses(
        async () => {
          release()
          await new Promise<void>((r) => clock.setTimeout(r, extra))
          return JSON.stringify({ bullets: TIDIED })
        },
        DRAFT_ANSWER,
        () => clock.advance(JOGGER_BUDGET_MS - 10),
      )
      const writing = kept(model, clock)
      await tidyAsked
      clock.advance(extra)
      const { jogger, outcomes } = await writing
      expect(asked, `the tidy pass was asked (${extra} ms)`).toHaveLength(2)
      expect(jogger.bullets, `a tidy answering ${extra} ms after a 29,990 ms first pass`).toEqual(expected)
      expect(outcomes, `${extra} ms`).toEqual([expected === TIDIED ? { tidied: true } : { tidied: false, why: 'late' }])
    }
  })

  // Operator answer 3: a conversation of an hour or more shares D116's "a few minutes", read as three, like the kept-conversations steps.
  it('shares three minutes instead of thirty seconds for a conversation of an hour or more', async () => {
    expect(joggerBudgetMs(60 * 60_000 - 1)).toBe(JOGGER_BUDGET_MS)
    expect(joggerBudgetMs(60 * 60_000)).toBe(JOGGER_LONG_BUDGET_MS)
    expect(JOGGER_LONG_BUDGET_MS).toBe(3 * 60_000)
    // A first pass of a minute: past the thirty seconds, inside the three minutes.
    for (const [conversationMs, expected] of [
      [60 * 60_000 - 1, 'over budget'],
      [60 * 60_000, 'tidied'],
      [3 * 60 * 60_000, 'tidied'],
    ] as const) {
      const clock = new VirtualClock(1e-9)
      const { model, asked } = twoPasses(answer(TIDIED), DRAFT_ANSWER, () => clock.advance(60_000))
      const outcomes: TidyOutcome[] = []
      const jogger = await writeKeptJogger(model, INPUT, { clock, conversationMs, onTidy: (o) => outcomes.push(o) })
      expect(asked, `${conversationMs} ms`).toHaveLength(expected === 'tidied' ? 2 : 1)
      expect(jogger.bullets, `${conversationMs} ms`).toEqual(expected === 'tidied' ? TIDIED : FIRST)
      expect(outcomes.map((o) => (o.tidied ? 'tidied' : o.why)), `${conversationMs} ms`).toEqual([expected])
    }
    // And the three minutes end where they do: a tidy still out a millisecond past them is dropped, one a millisecond inside is kept.
    for (const [extra, expected] of [
      [9, TIDIED],
      [10, FIRST],
    ] as const) {
      const clock = new VirtualClock(1e-9)
      let release!: () => void
      const tidyAsked = new Promise<void>((r) => (release = r))
      const { model } = twoPasses(
        async () => {
          release()
          await new Promise<void>((r) => clock.setTimeout(r, extra))
          return JSON.stringify({ bullets: TIDIED })
        },
        DRAFT_ANSWER,
        () => clock.advance(JOGGER_LONG_BUDGET_MS - 10),
      )
      const writing = writeKeptJogger(model, INPUT, { clock, conversationMs: 2 * 60 * 60_000 })
      await tidyAsked
      clock.advance(extra)
      expect((await writing).bullets, `a tidy answering ${extra} ms after a first pass of three minutes less 10 ms`).toEqual(expected)
    }
  })

  it('asks no tidy pass when the first used the thirty seconds, or there is nothing to tidy', async () => {
    const clock = new VirtualClock(1e-9)
    const slow = twoPasses(answer(TIDIED), DRAFT_ANSWER, () => clock.advance(JOGGER_BUDGET_MS))
    const { jogger, outcomes } = await kept(slow.model, clock)
    expect(slow.asked).toHaveLength(1)
    expect(jogger.bullets).toEqual(FIRST)
    expect(outcomes).toEqual([{ tidied: false, why: 'over budget' }])
    const silent = twoPasses(answer(TIDIED))
    const heardNothing = await writeKeptJogger(silent.model, { ...INPUT, transcript: [], promises: [], promiseTimes: [] }, { clock: new VirtualClock(1e-6), conversationMs: 25 * 60_000 })
    expect(silent.asked).toHaveLength(0)
    expect(heardNothing.bullets).toEqual(['4 minutes not heard'])
  })
})
