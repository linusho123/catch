// The names held for one conversation, in the order heard (D18), with the
// repeated-name rule (D87, D88): Catch cannot tell voices apart, so a name
// heard again within two minutes of its first appearance is a second person,
// `Priya (2)`, then `Priya (3)`; heard again later it is the same person
// re-introducing to a newcomer, shown again but listed once (D57). One
// exception (D132, amending D87): a name first heard in someone else's "meet
// X", followed inside the window by X's own introduction, is one person,
// introduced and then introducing: shown again, listed once, no `(2)`.

import type { Introduced } from './introductions.ts'

/** D87: two minutes. A ruling, not a tuning value. */
export const REPEATED_NAME_WINDOW_MS = 2 * 60 * 1000

export interface HeardName {
  /** What the lens line shows: `Priya`, or `Priya (2)` for a second person. */
  line: string
  /** True when the name joined the held names; false for a re-introduction. */
  added: boolean
}

interface Entry {
  name: string
  label: string
}

export class HeldNames {
  private entries: Entry[] = []
  /**
   * Per name (case-folded): when it was first heard, how many people carry
   * it, and whether its one carrier so far was named by someone's "meet X"
   * and has not yet introduced themselves (D132).
   */
  private seen = new Map<string, { firstAt: number; count: number; awaitingSelf: boolean }>()

  /** The held names in the order heard, as the names page lists them. */
  list(): string[] {
    return this.entries.map((e) => e.label)
  }

  /** A name caught at clock time `at` (ms), given `how` (D132; anything but a self-introduction after "meet X" follows D87). */
  hear(name: string, at: number, how: Introduced = 'other'): HeardName {
    const key = name.toLowerCase()
    const seen = this.seen.get(key)
    if (!seen) {
      this.seen.set(key, { firstAt: at, count: 1, awaitingSelf: how === 'meet' })
      this.entries.push({ name, label: name })
      return { line: name, added: true }
    }
    const inWindow = at - seen.firstAt <= REPEATED_NAME_WINDOW_MS
    // D132: the person "meet X" named, now introducing themselves.
    if (inWindow && how === 'self' && seen.awaitingSelf) {
      seen.awaitingSelf = false
      return { line: name, added: false }
    }
    seen.awaitingSelf = false
    if (inWindow) {
      seen.count += 1
      const label = `${name} (${seen.count})`
      this.entries.push({ name, label })
      return { line: label, added: true }
    }
    return { line: name, added: false }
  }

  clear(): void {
    this.entries = []
    this.seen.clear()
  }
}
