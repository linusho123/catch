import { PROMISE_MODEL } from '../llm/gemini.ts'
import type { ModelClient } from '../llm/client.ts'
import { SafeModelError } from '../llm/errors.ts'

// The commitment detector (D89, D90, D47): one model pass per candidate
// utterance of the wearer's, through the model client (cassettes under test).
// A candidate is a sentence of the wearer's that carries a commitment cue
// ("I'll", "I will", "I'm going to", "let me", "I promise", "will do"); every
// other sentence costs nothing. The model judges whether it is a commitment
// (considering it is not, D47), and writes it as a short command with any
// stated time or condition kept (D89), its object filled from what the other
// person just said when the wearer's words lack one (D90), "you" turned into
// the person's name. The lens shows the summary; the phone gets it as a
// command (`command`).
//
// Promises owed to the wearer (P5, D91, D26, D113): the same cue on another
// person's sentence earns a pass with its own prompt (`owedPrompt`), which
// writes the action alone, with no subject and no name in it ("I'll send you
// the deck tonight" becomes "send the deck tonight"): the "you" there is the
// wearer, the one receiving, and is left out, never turned into a name. Who
// promised is never the model's guess (Catch cannot tell voices apart, the
// fence's "Speaker identification"): the session names the promiser by the
// last name caught, or "they", and writes the owed line with the verb in the
// third person (`owedLine`: "Dev sends the deck tonight").

/** One sentence heard in this conversation, for the model's context. */
export interface Said {
  who: 'wearer' | 'other'
  text: string
}

/** The sentences before the candidate the model reads (the object of a bare "I'll do it" is in the last of them, D90). */
export const CONTEXT_SENTENCES = 4

const CUE = /\b(i'll|i will|i'm going to|i am going to|i'm gonna|let me|i promise|will do)\b/i

/** Whether a sentence of the wearer's is worth a model pass: it carries a commitment cue. */
export function isCandidate(text: string): boolean {
  return CUE.test(text.replace(/[’]/g, "'"))
}

/** The prompt for one candidate. Its words are the cassette's key: change them and the cassettes are re-recorded. */
export function promisePrompt(utterance: string, before: readonly Said[], names: readonly string[]): string {
  const context = before.length > 0 ? before.map((s) => `${s.who === 'wearer' ? 'Wearer' : 'Other'}: ${s.text}`).join('\n') : '(nothing yet)'
  return [
    'You read a live conversation for a person wearing smart glasses (the wearer) and decide whether the wearer has just made a promise.',
    '',
    `Names caught in this conversation, in the order heard: ${names.length > 0 ? names.join(', ') : '(none)'}`,
    'What was said just before, oldest first:',
    context,
    '',
    `The wearer now says: ${utterance}`,
    '',
    'A promise is the wearer committing to do something ("I\'ll send you the deck tonight"; "Yeah, I\'ll do it" in answer to a request). Considering, hedging or declining is not a promise ("I\'ll think about it", "I would if I could", "maybe").',
    'If it is a promise, write it as a short command to the wearer: start with the verb in lower case, never "I" or "you"; put the name of the person the wearer is promising in place of "you" (the name the wearer last addressed, in this sentence or in their own sentence just before it; or else the most recent name caught), keeping the wearer\'s own word order ("introduce you to Sam" becomes "introduce Dev to Sam") and every other word the wearer said, their possessives and articles included ("send you my transcript by Friday" becomes "send Ana my transcript by Friday", never "send Ana transcript by Friday"); keep any stated time or condition word for word ("tonight", "by Friday"); when the wearer\'s words lack the object, take it from what the other person just asked; write "intro" as "introduce".',
    'Answer with JSON only, one line: {"promise": true, "summary": "send Dev the deck tonight"} or {"promise": false}.',
  ].join('\n')
}

/** The prompt for another person's candidate sentence (P5). Its words are the cassette's key, as for the wearer's. */
export function owedPrompt(utterance: string, before: readonly Said[]): string {
  const context = before.length > 0 ? before.map((s) => `${s.who === 'wearer' ? 'Wearer' : 'Other'}: ${s.text}`).join('\n') : '(nothing yet)'
  return [
    'You read a live conversation for a person wearing smart glasses (the wearer) and decide whether someone other than the wearer has just promised the wearer something.',
    '',
    'What was said just before, oldest first:',
    context,
    '',
    `The other person now says: ${utterance}`,
    '',
    'A promise is the other person committing to do something ("I\'ll send you the agenda"; "Sure, I\'ll do it" in answer to the wearer\'s request). Considering, hedging or declining is not a promise ("I\'ll think about it", "I would if I could", "maybe").',
    'If it is a promise, write only what they will do, as a short action with no subject: start with the verb in lower case and in its plain form ("send", never "sends", "will send" or "I\'ll send"); never put the promiser\'s name or the wearer\'s in it, because the glasses add who promised; leave "you" out where it only names the wearer as the one receiving ("send you the deck tonight" becomes "send the deck tonight", never "send Dev the deck tonight" and never "send you the deck tonight"), and keep it where the action needs it ("call you on Monday", "introduce you to Sam"); their own "my" becomes "their"; keep every other word they said, articles included; keep any stated time or condition word for word ("tonight", "by Friday"); when their words lack the object, take it from what the wearer just asked; write "intro" as "introduce".',
    'Answer with JSON only, one line: {"promise": true, "summary": "send the agenda"} or {"promise": false}.',
  ].join('\n')
}

/** Verbs whose third person is not the regular one. */
const IRREGULAR: Record<string, string> = { be: 'is', have: 'has', do: 'does', go: 'goes' }

/** Subjects the promiser might keep before the action: dropped (risk-3). */
const SUBJECTS = new Set(['i', 'we', 'they', 'he', 'she'])
/** The same, contracted with a future modal ("I'll") or a "be" before "going to" ("I'm"): dropped. */
const SUBJECT_CONTRACTIONS = new Set(["i'll", "we'll", "they'll", "he'll", "she'll", "i'm", "we're", "they're", "he's", "she's"])
/** Modals that say no more than the promise does: dropped, and the verb after them conjugated. */
const FUTURE = new Set(['will', 'shall', 'gonna'])
/** Modals that say more: kept, and the action after them left in its plain form ("Dev can send the deck"). */
const OTHER_MODALS = new Set(['can', 'could', 'should', 'would', 'might', 'must', 'may'])

/**
 * The action with a leading subject or future modal gone (risk-3). The prompt
 * forbids both, but the demo runs on the live model: "will send the deck",
 * "I'll send the deck" and "I'm going to send the deck" are all "send the
 * deck". Words after the verb are never touched.
 */
function plainAction(words: string[]): string[] {
  const at = (i: number) => (words[i] ?? '').toLowerCase().replace(/’/g, "'")
  let i = 0
  if (SUBJECTS.has(at(i)) || SUBJECT_CONTRACTIONS.has(at(i))) i += 1
  if (FUTURE.has(at(i))) i += 1
  else if (['am', 'are', 'is'].includes(at(i)) && at(i + 1) === 'going' && at(i + 2) === 'to') i += 3
  else if (at(i) === 'going' && at(i + 1) === 'to') i += 2
  // Nothing left after them: the words as they came, rather than nothing.
  return i < words.length ? words.slice(i) : words
}

/**
 * An action in the plain form with its first word, the verb, in the third
 * person: "send the deck" becomes "sends the deck". A leading subject or
 * future modal goes first ("will send the deck" is "sends the deck"); an
 * action led by another modal keeps it and stays as it is ("can send the
 * deck"), never "cans send" (risk-3).
 */
export function thirdPerson(action: string): string {
  const words = plainAction(action.split(' '))
  if (OTHER_MODALS.has((words[0] ?? '').toLowerCase())) return words.join(' ')
  const [verb = '', ...rest] = words
  const lower = verb.toLowerCase()
  const third =
    IRREGULAR[lower] ??
    (/(s|x|z|ch|sh)$/.test(lower) ? `${verb}es` : /[^aeiou]y$/.test(lower) ? `${verb.slice(0, -1)}ies` : `${verb}s`)
  return [third, ...rest].join(' ')
}

/** An owed promise as Catch holds it: who promised, then what they will do. "Dev sends the agenda", "they (1) sends the deck tonight". */
export const owedLine = (promiser: string, action: string) => `${promiser} ${thirdPerson(action)}`

/**
 * A promise pass that failed, described without a word of the conversation:
 * the model's answer is derived from what was said (a summary, or a quote of
 * another person's words), so neither it nor the prompt goes into the message,
 * which the server logs (D76, fix round head-log-1).
 */
export class PromisePassError extends SafeModelError {
  override name = 'PromisePassError'
}

/**
 * The model's answer: the summary, or undefined when it is no promise.
 * Anything malformed is an error, never a guess, and the error names the
 * failure, never the answer's text (head-log-1). The summary is one line on
 * the lens and one line of the notification, so every run of whitespace in
 * it, a newline among them, becomes one space (risk-5).
 */
export function parsePromise(response: string): string | undefined {
  const json = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let answer: { promise?: unknown; summary?: unknown }
  try {
    answer = JSON.parse(json) as { promise?: unknown; summary?: unknown }
  } catch {
    // JSON.parse quotes the text it could not read; that text is the model's answer.
    throw new PromisePassError(`the promise model's answer was not JSON (${response.length} characters)`)
  }
  if (answer === null || typeof answer !== 'object') throw new PromisePassError('the promise model answered neither a promise nor no promise (not an object)')
  if (answer.promise === false) return undefined
  const summary = typeof answer.summary === 'string' ? answer.summary.replace(/\s+/g, ' ').trim() : ''
  if (answer.promise !== true || summary === '') {
    throw new PromisePassError(
      `the promise model answered neither a promise nor no promise (promise: ${typeof answer.promise === 'boolean' ? answer.promise : typeof answer.promise}, summary: ${typeof answer.summary === 'string' ? `${answer.summary.length} characters` : typeof answer.summary})`,
    )
  }
  return summary
}

export class PromiseDetector {
  private readonly model: ModelClient

  constructor(model: ModelClient) {
    this.model = model
  }

  /**
   * The summary of the wearer's promise in `utterance`, or undefined: no model
   * pass at all for a sentence with no cue. `signal` cancels the model call
   * (the session aborts a pass whose answer could go nowhere, risk-2).
   */
  async detect(utterance: string, before: readonly Said[], names: readonly string[], signal?: AbortSignal): Promise<string | undefined> {
    if (!isCandidate(utterance)) return undefined
    const prompt = promisePrompt(utterance, before.slice(-CONTEXT_SENTENCES), names)
    return parsePromise(await this.model.complete(PROMISE_MODEL, prompt, signal ? { signal } : undefined))
  }

  /** The action another person has promised the wearer in `utterance` (P5, D91), or undefined; no pass for a sentence with no cue. */
  async detectOwed(utterance: string, before: readonly Said[], signal?: AbortSignal): Promise<string | undefined> {
    if (!isCandidate(utterance)) return undefined
    const prompt = owedPrompt(utterance, before.slice(-CONTEXT_SENTENCES))
    return parsePromise(await this.model.complete(PROMISE_MODEL, prompt, signal ? { signal } : undefined))
  }
}

/** A summary as the phone writes it: a command, "Send Dev the deck tonight" (D28, D117). */
export const command = (summary: string) => summary.charAt(0).toUpperCase() + summary.slice(1)
