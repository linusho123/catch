// The dropped thread (D35, D48, D49, D50, D33, D36): when the wearer stops
// mid-sentence and someone else takes the floor, the wearer's last words wait
// on the lens. This module holds the rules as plain data; session.ts feeds it
// every judged word, on the session's timeline (seconds), and shows what it says.
//
// - The thread is the wearer's most recent continuous run (D48): it starts
//   again the first time the wearer speaks after anyone else has, so it never
//   reaches back across someone else's turn (D50), however short that turn.
//   Silence alone does not end it (D49: "with nobody speaking in between").
// - The wearer stopped mid-sentence when the run's last word carries no
//   terminal punctuation in the provider's punctuated transcript (Deepgram's
//   `punctuated_word`, D126). That is the clause-end signal (DESIGN.md, chosen):
//   a finished sentence followed by someone talking is a normal turn (D33).
// - Someone else has taken the floor once their speech since the wearer's last
//   word has run continuously for FLOOR_S (D35's two to three seconds); a gap
//   longer than FLOOR_GAP_S starts the stretch again. Silence never takes the
//   floor (D36), however long it lasts.
// - It fires once per run: a line the wearer tapped away does not come back
//   while the same person keeps talking.

/** D35: someone else has taken the floor after two to three seconds of continuous speech; the line comes at two. A ruling, not a tuning value. */
export const FLOOR_S = 2

/**
 * The longest silence inside one stretch of someone else's speech that still
 * counts as continuous (D35). Not a ruling: a tuning value for the shipping
 * step (DESIGN.md, chosen), well under D33's second-and-a-half polite gap.
 */
export const FLOOR_GAP_S = 0.75

/**
 * The words the thread line shows after its ellipsis. D35 and D48 say six
 * words; every example the visionary ruled shows the ellipsis and five
 * (`…and the second reason is`, `…we chose it. Well, the`), and the feature
 * file binds those rows, so the ellipsis is counted as the sixth. Raised with
 * the operator (P3 open question).
 */
export const THREAD_WORDS = 5

export const ELLIPSIS = '…'

/** Whether a word as the provider punctuated it ends a sentence. */
export function endsSentence(word: string): boolean {
  return /[.!?]["'”’)\]]*$/.test(word)
}

/** The line for a run: the ellipsis, then its last words (a shorter run whole, D48). */
export function threadLine(run: readonly string[]): string {
  return ELLIPSIS + run.slice(-THREAD_WORDS).join(' ')
}

/** The most words of a run kept: enough for the line, with room to spare. */
const KEEP = 32

export class Thread {
  /** The wearer's most recent continuous run, its words as the provider punctuated them. */
  private run: string[] = []
  /** Someone else has spoken since the run's last word: the wearer's next word starts a new run. */
  private interrupted = false
  /** Someone else's continuous speech since the wearer's last word: where it began, and where its latest word ended. */
  private floor: { start: number; end: number } | undefined
  /** The line has fired for this run. */
  private fired = false

  /** A word of the wearer's. */
  wearer(text: string): void {
    if (this.interrupted) {
      this.run = []
      this.interrupted = false
      this.fired = false
    }
    this.run.push(text)
    if (this.run.length > KEEP) this.run.splice(0, this.run.length - KEEP)
    this.floor = undefined
  }

  /**
   * A word of someone else's, timed on the session's timeline. Returns the
   * line when this word is the one with which they take the floor from a
   * wearer who stopped mid-sentence; otherwise undefined.
   */
  other(start: number, end: number): string | undefined {
    this.interrupted = true
    if (this.floor && start - this.floor.end <= FLOOR_GAP_S) this.floor.end = Math.max(this.floor.end, end)
    else this.floor = { start, end }
    if (this.fired || this.run.length === 0) return undefined
    if (endsSentence(this.run.at(-1)!)) return undefined
    if (this.floor.end - this.floor.start < FLOOR_S) return undefined
    this.fired = true
    return threadLine(this.run)
  }

  /** The wearer's last words as a line, for the held page when detection is off (D120); undefined before the wearer has spoken. */
  line(): string | undefined {
    return this.run.length > 0 ? threadLine(this.run) : undefined
  }

  /** The conversation ended: nothing of it carries over. */
  clear(): void {
    this.run = []
    this.interrupted = false
    this.floor = undefined
    this.fired = false
  }
}
