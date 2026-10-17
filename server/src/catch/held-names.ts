// The names held for one conversation, in the order heard (D18), with the
// repeated-name rule (D87, D88): Catch cannot tell voices apart, so a name
// heard again within two minutes of its first appearance is a second person,
// `Priya (2)`, then `Priya (3)`; heard again later it is the same person
// re-introducing to a newcomer, shown again but listed once (D57).

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
  /** Per name (case-folded): when it was first heard, and how many people carry it. */
  private seen = new Map<string, { firstAt: number; count: number }>()

  /** The held names in the order heard, as the names page lists them. */
  list(): string[] {
    return this.entries.map((e) => e.label)
  }

  /** A name caught at clock time `at` (ms). */
  hear(name: string, at: number): HeardName {
    const key = name.toLowerCase()
    const seen = this.seen.get(key)
    if (!seen) {
      this.seen.set(key, { firstAt: at, count: 1 })
      this.entries.push({ name, label: name })
      return { line: name, added: true }
    }
    if (at - seen.firstAt <= REPEATED_NAME_WINDOW_MS) {
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
