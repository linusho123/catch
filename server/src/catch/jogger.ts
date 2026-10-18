import type { Clock, TimerHandle } from '../../../shared/clock.ts'
import { JOGGER_MODEL } from '../llm/gemini.ts'
import type { CallOptions, ModelClient } from '../llm/client.ts'
import { SafeModelError } from '../llm/errors.ts'
import type { Gap } from './session.ts'
import type { TranscriptWord } from './transcript.ts'

// The jogger writer (D24, D62, D99, D116, D53): one model pass per kept
// conversation, through the model client (cassettes under test), on
// gemini-3.5-flash-lite (P4 fix round: D116's thirty seconds). The model
// reads the conversation's transcript as numbered lines and writes the
// specifics back as short bullets, each tagged with the line it comes from;
// the code puts them in the order things came up (D99) and adds what the
// model is never trusted with:
//   - the wearer's promises, as bullets of their own at the line each was
//     said, in the words the lens and the phone already use (D89, D99);
//   - a `N minutes not heard` line where each span Catch could not hear fell,
//     saying how long and never when (D53);
//   - honesty about the bold: a term set in bold that the transcript does not
//     contain loses its bold, so the jogger never presents an invented term
//     as one that came up (the second reviewer's focus).
// One flat list, no fixed count, no sections (D24, D74, D99): the prompt asks
// for exactly that and the code caps nothing. Nothing the writer throws quotes
// the conversation (head-log-1).
//
// Then the tidy pass (P7, the operator's `chosen` change): a second call on
// the same model, grounded on the same transcript, given the first draft and
// asked to merge bullets that say the same thing or split one point between
// them, drop filler, fix spoken grammar and keep each bullet short, copying
// the code's own bullets (the promises, the missed time) word for word at
// their places, adding nothing the transcript does not say. Its answer gets
// the honest bold again and a structural check (writeKeptJogger): a promise
// or a missed-time line lost, moved or invented, a bold term the draft had
// lost or moved, a heading, a longer list, a bullet longer than the draft's
// longest, or a name or number neither the transcript nor the draft has, and
// the first draft is kept. Both passes share D116's thirty seconds on the
// injected clock: a tidy pass that fails, has not answered when they run out,
// or would start after they have, leaves the first draft to be stored as it
// is.

/** One line of the transcript as the jogger's model reads it: a sentence, or a run of one side's words. */
export interface JoggerLine {
  side: 'wearer' | 'other'
  text: string
  start: number
  end: number
}

/** What the writer is given: what a kept conversation hands on as it ends (session.ts). */
export interface JoggerInput {
  names: readonly string[]
  transcript: readonly TranscriptWord[]
  promises: readonly string[]
  /** Where each promise was said (the end of its sentence, on the session's timeline, seconds). */
  promiseTimes: readonly number[]
  gaps: readonly Gap[]
}

/** A jogger: one flat list of bullets, in the order things came up, technical terms in `**bold**` (D99). */
export interface Jogger {
  bullets: string[]
}

/** A first draft: the jogger, and the bullets the code placed itself (the promises and the missed time), in order. */
export interface Draft extends Jogger {
  fixed: string[]
}

/** D116: a kept conversation under an hour has its jogger within thirty seconds; both passes share them. */
export const JOGGER_BUDGET_MS = 30_000

/** A jogger pass that failed, described without a word of the conversation (head-log-1). */
export class JoggerPassError extends SafeModelError {
  override name = 'JoggerPassError'
}

/** The transcript as lines: a new line at each change of side and after each sentence's end. */
export function joggerLines(words: readonly TranscriptWord[]): JoggerLine[] {
  const lines: JoggerLine[] = []
  let open: JoggerLine | undefined
  for (const w of words) {
    if (!open || open.side !== w.side) {
      open = { side: w.side, text: w.text, start: w.start, end: w.end }
      lines.push(open)
    } else {
      open.text += ` ${w.text}`
      open.end = w.end
    }
    if (/[.!?]$/.test(w.text)) open = undefined
  }
  return lines
}

/** D53: how long a span went unheard, in whole minutes, and never when; nothing for a span under half a minute. */
export function notHeard(ms: number): string | undefined {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return undefined
  return `${minutes} minute${minutes === 1 ? '' : 's'} not heard`
}

/** The line (1-based) a moment on the timeline falls in or before: the first line that has not ended by then. */
function lineAt(lines: readonly JoggerLine[], at: number): number {
  const i = lines.findIndex((l) => l.end >= at - 1e-6)
  return i === -1 ? lines.length : i + 1
}

/** The prompt for one kept conversation. Its words are the cassette's key: change them and the cassettes are re-recorded. */
export function joggerPrompt(lines: readonly JoggerLine[], names: readonly string[], promiseLines: readonly number[]): string {
  const numbered = lines.map((l, i) => `${i + 1} ${l.side === 'wearer' ? 'Wearer' : 'Other'}: ${l.text}`).join('\n')
  const unique = [...new Set(promiseLines)]
  const promises =
    unique.length === 0
      ? []
      : [
          `- ${unique.length === 1 ? `Line ${unique[0]} is` : `Lines ${unique.slice(0, -1).join(', ')} and ${unique.at(-1)} are`} the wearer's own promise${unique.length === 1 ? '' : 's'}: each is added as a bullet of its own, so write no bullet for ${unique.length === 1 ? 'it' : 'them'}.`,
        ]
  return [
    'You write a memory jogger for a person wearing smart glasses (the wearer), from the transcript of a conversation the wearer chose to keep. The wearer already grasps the conversation; the jogger gives back only the specifics, quick to read.',
    '',
    `Names caught in this conversation, in the order heard: ${names.length > 0 ? names.join(', ') : '(none)'}`,
    'The transcript, one numbered line per sentence; "Wearer" is the wearer, "Other" is anyone else:',
    numbered,
    '',
    'Write the jogger as short bullets, in the order things came up:',
    '- One flat list: no headings, no sections, no bullet that only introduces the ones after it, no glossary, no summary paragraph.',
    '- As many bullets as the specifics demand and no more: never pad, and never drop a specific to keep the list short.',
    '- Cover what was said about each topic and every specific technical term that came up.',
    '- Keep every question raised as a question in its bullet, with its answer when one came ("Asked when the beta ships: in March.").',
    '- Set every technical term in bold with double asterisks: every named tool, product, technique, method or field (**contrastive learning**, **PyTorch**), each time it first comes up, word for word as the transcript has it and only the term itself, never a word around it (**contrastive learning** runs, not **contrastive learning runs**); bold nothing else.',
    '- Use only what the transcript says: never add a term, a fact or a name it does not contain.',
    '- Never say when anything was said: no times of day.',
    ...promises,
    'Answer with JSON only: {"bullets": [{"line": 3, "text": "..."}]}, where "line" is the number of the transcript line the bullet comes from.',
  ].join('\n')
}

/** The model's bullets, each with its line; anything malformed is an error naming the failure, never the answer's text. */
export function parseJogger(response: string, lineCount: number): { line: number; text: string }[] {
  const json = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let answer: { bullets?: unknown }
  try {
    answer = JSON.parse(json) as { bullets?: unknown }
  } catch {
    throw new JoggerPassError(`the jogger model's answer was not JSON (${response.length} characters)`)
  }
  if (answer === null || typeof answer !== 'object' || !Array.isArray(answer.bullets)) throw new JoggerPassError('the jogger model answered no list of bullets')
  return answer.bullets.map((b: unknown, i) => {
    const { line, text } = (b ?? {}) as { line?: unknown; text?: unknown }
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
    if (clean === '') throw new JoggerPassError(`the jogger model's bullet ${i + 1} has no text`)
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > lineCount) {
      throw new JoggerPassError(`the jogger model's bullet ${i + 1} names no line of the transcript (1 to ${lineCount})`)
    }
    return { line, text: clean }
  })
}

/**
 * Lower case, words stripped of the punctuation around them, one space
 * between: how a term is looked for in the transcript. A `#` or `+` at a
 * word's edge is kept, as part of the term (C#, C++; fix round, risk-3).
 */
const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}#+]+|[^\p{L}\p{N}#+]+$/gu, ''))
    .filter(Boolean)
    .join(' ')

/**
 * A bullet with the bold kept only on terms the transcript contains (the
 * second reviewer's focus: no invented term in bold). A term is looked for
 * inside one sentence at a time: the transcript is cut at each line break and
 * after each `.`, `!` or `?` that ends a word, so "learning. Rate" is not
 * "learning rate" (risk-3).
 */
export function honestBold(text: string, transcript: string): string {
  const sentences = transcript.split(/\n|(?<=[.!?])\s+/).map((s) => ` ${normalized(s)} `)
  return text.replace(/\*\*(.+?)\*\*/g, (_whole, term: string) => {
    const t = normalized(term)
    return t !== '' && sentences.some((s) => s.includes(` ${t} `)) ? `**${term.trim()}**` : term
  })
}

/**
 * Writes a kept conversation's jogger: the model's bullets in the order
 * things came up, the wearer's promises at the lines they were said, and a
 * `N minutes not heard` line where each gap fell (D53, D99).
 */
export async function writeJogger(model: ModelClient, input: JoggerInput, call?: CallOptions): Promise<Draft> {
  const lines = joggerLines(input.transcript)
  const promiseLines = input.promiseTimes.map((t) => lineAt(lines, t))
  let said: { line: number; text: string }[] = []
  if (lines.length > 0) {
    const response = await model.complete(JOGGER_MODEL, joggerPrompt(lines, input.names, promiseLines), call)
    const transcript = lines.map((l) => l.text).join('\n')
    said = parseJogger(response, lines.length).map((b) => ({ line: b.line, text: honestBold(b.text, transcript) }))
  }
  // Each bullet's place: a model bullet at its line; a promise just before the bullets from its own line;
  // a gap after every line that had ended when Catch stopped hearing (D53).
  const placed = [
    ...said.map((b) => ({ key: b.line, text: b.text, fixed: false })),
    ...input.promises.map((p, i) => ({ key: promiseLines[i]! - 0.25, text: `You promised: ${p}`, fixed: true })),
    ...input.gaps.flatMap((g) => {
      const text = notHeard(g.ms)
      const before = lines.filter((l) => l.end <= g.at + 1e-6).length
      return text ? [{ key: before + 0.5, text, fixed: true }] : []
    }),
  ]
  // A stable sort: bullets from one line keep the model's order.
  const sorted = placed.map((b, i) => ({ ...b, i })).sort((a, b) => a.key - b.key || a.i - b.i)
  return { bullets: sorted.map((b) => b.text), fixed: sorted.filter((b) => b.fixed).map((b) => b.text) }
}

/** The tidy pass's prompt: the transcript it is grounded on, the draft, and the bullets to copy as they are. Its words are the cassette's key. */
export function tidyPrompt(lines: readonly JoggerLine[], draft: Draft): string {
  const numbered = lines.map((l, i) => `${i + 1} ${l.side === 'wearer' ? 'Wearer' : 'Other'}: ${l.text}`).join('\n')
  const keep =
    draft.fixed.length === 0
      ? []
      : ['- Copy each of these bullets exactly as it is, character for character, at its place in the order; never merge, reword, move or drop them:', ...draft.fixed.map((f) => `  ${f}`)]
  return [
    'You tidy a memory jogger for a person wearing smart glasses (the wearer): a list of short bullets written from the transcript of a conversation the wearer chose to keep. The jogger gives back only the specifics, quick to read.',
    '',
    'The transcript, one numbered line per sentence; "Wearer" is the wearer, "Other" is anyone else:',
    numbered,
    '',
    'The draft jogger, one bullet per line, in the order things came up:',
    ...draft.bullets.map((b, i) => `${i + 1}. ${b}`),
    '',
    'Tidy the draft, changing only what these rules ask:',
    '- Merge bullets that say the same thing, or that split one point between them, into one bullet.',
    '- Drop filler: words that carry nothing specific, and bullets that are only small talk.',
    '- Fix the grammar of spoken language. Write each bullet as one short sentence ending with a full stop.',
    '- Keep the order things came up in: never move a point before one that came up earlier.',
    '- One flat list: no headings, no sections, no bullet that only introduces the ones after it, no glossary, no summary. No fixed count: as many bullets as the specifics need, never more bullets than the draft.',
    '- Keep every term the draft sets in bold with double asterisks, in bold, word for word, the first time it comes up; bold nothing else, and never a name.',
    '- Keep every question raised in its bullet with its answer when one came, the way the draft writes it ("Asked when the beta ships: in March.").',
    '- Use only what the transcript says: never add a term, a fact, a number or a name it does not contain.',
    '- Never say when anything was said: no times of day.',
    ...keep,
    'Answer with JSON only: {"bullets": ["...", "..."]}',
  ].join('\n')
}

/** The tidy pass's bullets; anything malformed is an error naming the failure, never the answer's text. */
export function parseTidy(response: string): string[] {
  const json = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let answer: { bullets?: unknown }
  try {
    answer = JSON.parse(json) as { bullets?: unknown }
  } catch {
    throw new JoggerPassError(`the jogger tidy pass's answer was not JSON (${response.length} characters)`)
  }
  if (answer === null || typeof answer !== 'object' || !Array.isArray(answer.bullets)) throw new JoggerPassError('the jogger tidy pass answered no list of bullets')
  return answer.bullets.map((b: unknown, i) => {
    const clean = typeof b === 'string' ? b.replace(/\s+/g, ' ').trim() : ''
    if (clean === '') throw new JoggerPassError(`the jogger tidy pass's bullet ${i + 1} has no text`)
    return clean
  })
}

const BOLD = /\*\*(.+?)\*\*/g
const wordCount = (text: string) => text.replace(BOLD, '$1').split(/\s+/).filter(Boolean).length
/** What must come through a tidy in order: each code-placed bullet, and each term in bold the first time it is. */
function marks(bullets: readonly string[], fixed: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const b of bullets) {
    if (fixed.has(b)) out.push(`fixed ${b}`)
    else for (const m of b.matchAll(BOLD)) if (!out.includes(`bold ${normalized(m[1]!)}`)) out.push(`bold ${normalized(m[1]!)}`)
  }
  return out
}
/** The names and numbers in a bullet: every capitalized word but its first, and every word with a digit. */
const namesAndNumbers = (text: string) =>
  text
    .replace(BOLD, '$1')
    .split(/\s+/)
    .slice(1)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => /^\p{Lu}/u.test(t) || /\d/.test(t))
    .map((t) => t.toLowerCase())

/**
 * Why a tidied draft is not kept, or undefined when it is: the structural
 * check (D99's rules and nothing added). The reason names only the rule,
 * never a word of the conversation (head-log-1).
 */
export function tidyRejection(draft: Draft, tidied: readonly string[], transcript: string): string | undefined {
  if (tidied.length === 0) return 'it answered no bullets'
  if (tidied.length > draft.bullets.length) return 'it has more bullets than the draft'
  const fixed = new Set(draft.fixed)
  for (const b of tidied) {
    if (fixed.has(b)) continue
    if (/^you promised:/i.test(b) || /\bnot heard\.?$/i.test(b)) return 'it has a promise or a missed-time line the draft does not'
    if (b.trim().endsWith(':') || b.startsWith('#')) return 'it has a heading'
    if (b.replace(BOLD, '').trim() === '' && /\*\*(.+?)\*\*/.test(b)) return 'it has a bullet all in bold'
  }
  if (tidied.filter((b) => fixed.has(b)).length !== draft.fixed.length) return 'a promise or a missed-time line is lost or doubled'
  const before = marks(draft.bullets, fixed)
  const after = marks(tidied, fixed).filter((m) => before.includes(m))
  if (after.join('\n') !== before.join('\n')) return 'a promise, a missed-time line or a term in bold is lost or out of order'
  const longest = Math.max(25, ...draft.bullets.map(wordCount))
  if (tidied.some((b) => wordCount(b) > longest)) return 'a bullet is longer than the draft allows'
  const known = new Set(normalized(`${transcript} ${draft.bullets.join(' ')}`).split(' '))
  if (tidied.some((b) => !fixed.has(b) && namesAndNumbers(b).some((t) => !known.has(t)))) return 'it has a name or a number neither the transcript nor the draft has'
  if (tidied.some((b) => /\b\d{1,2}:\d{2}\b/.test(b))) return 'it says when something was said'
  return undefined
}

/** How a kept conversation's tidy pass went: tidied, or why the first draft was stored as it is. */
export type TidyOutcome =
  | { tidied: true }
  | { tidied: false; why: 'over budget' | 'late' | 'nothing to tidy' }
  | { tidied: false; why: 'rejected'; reason: string }
  | { tidied: false; why: 'failed'; error: unknown }

export interface KeptJoggerOptions {
  clock: Clock
  /** Cancels both passes: the server closing, or the wearers forgotten. */
  signal?: AbortSignal
  /** D116's thirty seconds by default; when the first pass started counts from the call. */
  budgetMs?: number
  onTidy?: (outcome: TidyOutcome) => void
}

/**
 * A kept conversation's jogger: the first draft (writeJogger), then the tidy
 * pass within what is left of the shared budget. A first pass that fails
 * throws, as before; a tidy pass that fails, is late, is over budget or is
 * rejected leaves the first draft, reported through `onTidy`.
 */
export async function writeKeptJogger(model: ModelClient, input: JoggerInput, opts: KeptJoggerOptions): Promise<Jogger> {
  const { clock, signal } = opts
  const report = (outcome: TidyOutcome) => opts.onTidy?.(outcome)
  const deadline = clock.now() + (opts.budgetMs ?? JOGGER_BUDGET_MS)
  const draft = await writeJogger(model, input, signal ? { signal } : undefined)
  const first: Jogger = { bullets: draft.bullets }
  const lines = joggerLines(input.transcript)
  if (lines.length === 0 || draft.bullets.length === draft.fixed.length) {
    report({ tidied: false, why: 'nothing to tidy' })
    return first
  }
  const left = deadline - clock.now()
  if (left <= 0) {
    report({ tidied: false, why: 'over budget' })
    return first
  }
  const abort = new AbortController()
  const cancel = () => abort.abort()
  signal?.addEventListener('abort', cancel)
  let timer: TimerHandle | undefined
  const late = new Promise<'late'>((resolve) => (timer = clock.setTimeout(() => resolve('late'), left)))
  const transcript = lines.map((l) => l.text).join('\n')
  try {
    const answer = await Promise.race([model.complete(JOGGER_MODEL, tidyPrompt(lines, draft), { signal: abort.signal }), late])
    if (answer === 'late') {
      abort.abort()
      report({ tidied: false, why: 'late' })
      return first
    }
    const tidied = parseTidy(answer).map((b) => (draft.fixed.includes(b) ? b : honestBold(b, transcript)))
    const reason = tidyRejection(draft, tidied, transcript)
    if (reason) {
      report({ tidied: false, why: 'rejected', reason })
      return first
    }
    report({ tidied: true })
    return { bullets: tidied }
  } catch (error) {
    if (signal?.aborted) throw error
    report({ tidied: false, why: 'failed', error })
    return first
  } finally {
    if (timer) clock.clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
