import { JOGGER_MODEL } from '../llm/gemini.ts'
import type { CallOptions, ModelClient } from '../llm/client.ts'
import { SafeModelError } from '../llm/errors.ts'
import type { Gap } from './session.ts'
import type { TranscriptWord } from './transcript.ts'

// The jogger writer (D24, D62, D99, D116, D53): one model pass per kept
// conversation, through the model client (cassettes under test), on
// gemini-3.8-flash. The model reads the conversation's transcript as numbered
// lines and writes the specifics back as short bullets, each tagged with the
// line it comes from; the code puts them in the order things came up (D99)
// and adds what the model is never trusted with:
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
    '- Set each technical term in bold with double asterisks, word for word as the transcript has it (**contrastive learning**); bold nothing else.',
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

/** Lower case, words stripped of the punctuation around them, one space between: how a term is looked for in the transcript. */
const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .join(' ')

/** A bullet with the bold kept only on terms the transcript contains (the second reviewer's focus: no invented term in bold). */
export function honestBold(text: string, transcript: string): string {
  const heard = ` ${normalized(transcript)} `
  return text.replace(/\*\*(.+?)\*\*/g, (_whole, term: string) => {
    const t = normalized(term)
    return t !== '' && heard.includes(` ${t} `) ? `**${term.trim()}**` : term
  })
}

/**
 * Writes a kept conversation's jogger: the model's bullets in the order
 * things came up, the wearer's promises at the lines they were said, and a
 * `N minutes not heard` line where each gap fell (D53, D99).
 */
export async function writeJogger(model: ModelClient, input: JoggerInput, call?: CallOptions): Promise<Jogger> {
  const lines = joggerLines(input.transcript)
  const promiseLines = input.promiseTimes.map((t) => lineAt(lines, t))
  let said: { line: number; text: string }[] = []
  if (lines.length > 0) {
    const response = await model.complete(JOGGER_MODEL, joggerPrompt(lines, input.names, promiseLines), call)
    const transcript = lines.map((l) => l.text).join(' ')
    said = parseJogger(response, lines.length).map((b) => ({ line: b.line, text: honestBold(b.text, transcript) }))
  }
  // Each bullet's place: a model bullet at its line; a promise just before the bullets from its own line;
  // a gap after every line that had ended when Catch stopped hearing (D53).
  const placed = [
    ...said.map((b) => ({ key: b.line, text: b.text })),
    ...input.promises.map((p, i) => ({ key: promiseLines[i]! - 0.25, text: `You promised: ${p}` })),
    ...input.gaps.flatMap((g) => {
      const text = notHeard(g.ms)
      const before = lines.filter((l) => l.end <= g.at + 1e-6).length
      return text ? [{ key: before + 0.5, text }] : []
    }),
  ]
  // A stable sort: bullets from one line keep the model's order.
  return { bullets: placed.map((b, i) => ({ ...b, i })).sort((a, b) => a.key - b.key || a.i - b.i).map((b) => b.text) }
}
