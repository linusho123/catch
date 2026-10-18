import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../llm/client.ts'
import { PROMISE_MODEL } from '../llm/gemini.ts'
import { command, isCandidate, owedLine, owedPrompt, parsePromise, PromiseDetector, promisePrompt, thirdPerson } from './promises.ts'

// The commitment detector on its own: which sentences are worth a model pass,
// what the pass is asked, and how its answer is read.

describe('the promise detector', () => {
  it('asks the model only about sentences with a commitment cue', () => {
    for (const s of ["I'll send you the deck tonight.", "Yeah, I'll do it.", 'I will call you.', "I'm going to book it.", 'Let me check.', 'I promise.', 'Will do.', 'I’ll think about it.']) {
      expect(isCandidate(s), s).toBe(true)
    }
    for (const s of ['I would if I could.', 'Good to meet you, Dev.', "Hi, I'm Linus.", 'That will be fine.', 'Sure, see you at lunch then.']) {
      expect(isCandidate(s), s).toBe(false)
    }
  })

  it('reads a promise, no promise, and a fenced answer; anything else is an error, never a guess', () => {
    expect(parsePromise('{"promise": true, "summary": "send Dev the deck tonight"}')).toBe('send Dev the deck tonight')
    expect(parsePromise('```json\n{"promise": false}\n```')).toBeUndefined()
    expect(() => parsePromise('{"promise": true}')).toThrow(/neither/)
    expect(() => parsePromise('yes')).toThrow()
  })

  it("puts the names caught and the sentences before it into the prompt, on the promise model, and makes no pass for a sentence with no cue", async () => {
    const asked: { model: string; prompt: string }[] = []
    const model: ModelClient = {
      async complete(m, prompt) {
        asked.push({ model: m, prompt })
        return '{"promise": true, "summary": "send Dev the budget by Friday"}'
      },
    }
    const detector = new PromiseDetector(model)
    const before = [
      { who: 'wearer' as const, text: 'Good to meet you, Dev.' },
      { who: 'other' as const, text: 'Can you send me the budget by Friday?' },
    ]
    expect(await detector.detect("Yeah, I'll do it.", before, ['Dev'])).toBe('send Dev the budget by Friday')
    expect(await detector.detect('Sounds good.', before, ['Dev'])).toBeUndefined()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.model).toBe(PROMISE_MODEL)
    expect(asked[0]!.prompt).toBe(promisePrompt("Yeah, I'll do it.", before, ['Dev']))
    expect(asked[0]!.prompt).toContain('Names caught in this conversation, in the order heard: Dev')
    expect(asked[0]!.prompt).toContain('Other: Can you send me the budget by Friday?')
    expect(asked[0]!.prompt).toContain("The wearer now says: Yeah, I'll do it.")
  })

  // Fix round, risk-5: a summary is one line on the lens and one line of the notification's body.
  it('collapses every run of whitespace in the summary, newlines among them, to one space (risk-5)', () => {
    expect(parsePromise('{"promise": true, "summary": "  send Dev\\nthe deck\\t\\r\\n  tonight "}')).toBe('send Dev the deck tonight')
  })

  // Fix round, head-log-1: the model's answer is derived from the conversation, so it never reaches an error (or a log).
  it("names a malformed answer's failure without the answer's text (head-log-1)", () => {
    for (const answer of ['The Xylophone plan, yes.', '{"promise": "maybe", "summary": "send Xylophone the deck"}', '{"promise": true, "summary": "Xylophone', '{"promise": true}']) {
      let thrown: unknown
      try {
        parsePromise(answer)
      } catch (error) {
        thrown = error
      }
      expect(thrown, answer).toBeInstanceOf(Error)
      expect((thrown as Error).message, answer).not.toMatch(/xylophone|[{}"]/i)
      expect(String((thrown as Error).stack), answer).not.toMatch(/xylophone/i)
      expect(JSON.stringify(thrown), answer).not.toMatch(/xylophone/i)
    }
  })

  it('writes a summary as a command for the phone', () => {
    expect(command('send Dev the deck tonight')).toBe('Send Dev the deck tonight')
  })
})

describe('the owed prompt and the owed line (P5, D91)', () => {
  it("asks about the other person's sentence, never puts a name in the action, and leaves the wearer's \"you\" out", () => {
    const prompt = owedPrompt("I'll send you the agenda.", [{ who: 'wearer', text: "Dev, I'll send you the deck." }])
    expect(prompt).toMatch(/^The other person now says: I'll send you the agenda\.$/m)
    expect(prompt).not.toMatch(/^The wearer now says:/m)
    expect(prompt).toMatch(/Wearer: Dev, I'll send you the deck\./)
    expect(prompt).toMatch(/never "send Dev the deck tonight"/)
    expect(prompt).toMatch(/never put the promiser's name or the wearer's in it/)
    // It is another prompt than the wearer's, so it has its own cassette.
    expect(prompt).not.toBe(promisePrompt("I'll send you the agenda.", [{ who: 'wearer', text: "Dev, I'll send you the deck." }], []))
  })

  it('puts the action\'s verb in the third person behind the promiser: "Dev sends the agenda"', () => {
    expect(owedLine('Dev', 'send the agenda')).toBe('Dev sends the agenda')
    expect(owedLine('they (1)', 'send the deck tonight')).toBe('they (1) sends the deck tonight')
    expect(thirdPerson('share the notes')).toBe('shares the notes')
    expect(thirdPerson('introduce you to Sam')).toBe('introduces you to Sam')
    expect(thirdPerson('fix the build')).toBe('fixes the build')
    expect(thirdPerson('push the branch')).toBe('pushes the branch')
    expect(thirdPerson('watch the demo')).toBe('watches the demo')
    expect(thirdPerson('carry the boxes')).toBe('carries the boxes')
    expect(thirdPerson('pay you back')).toBe('pays you back')
    expect(thirdPerson('do it')).toBe('does it')
    expect(thirdPerson('go over the plan')).toBe('goes over the plan')
    expect(thirdPerson('have it ready by Friday')).toBe('has it ready by Friday')
  })

  it('costs no model pass for a sentence of theirs with no commitment cue', async () => {
    const asked: string[] = []
    const detector = new PromiseDetector({ complete: async (_m, prompt) => (asked.push(prompt), '{"promise": false}') })
    expect(await detector.detectOwed('Great, see you then.', [])).toBeUndefined()
    expect(asked).toEqual([])
    expect(await detector.detectOwed("I'll think about it.", [])).toBeUndefined()
    expect(asked).toHaveLength(1)
  })
})
