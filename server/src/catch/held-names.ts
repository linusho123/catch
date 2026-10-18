// The names held for one conversation, in the order heard (D18), with the
// repeated-name rule (D87, D88): Catch cannot tell voices apart, so a name
// heard again within two minutes of its first appearance is a second person,
// `Priya (2)`, then `Priya (3)`; heard again later it is the same person
// re-introducing to a newcomer, shown again but listed once (D57). One
// exception (D132, amending D87): a name first heard in someone else's "meet
// X", followed inside the window by X's own introduction, is one person,
// introduced and then introducing: shown again, listed once, no `(2)`.
//
// A name caught from an interim result (PT) is held tentatively until the
// provider's final words say it too: shown, and on the names page, but not
// yet in what a restart keeps, the promise detector's names, or the names a
// conversation ends with. Confirmed, it stays as it was heard (no second
// line, no `(2)`); withdrawn (the final words disagree), it goes as if it had
// never been heard, and every later name is reckoned again without it.

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

/** The held names as the store keeps them across a restart (P9, D73): the list in order, and each name's window. */
export interface HeldNamesState {
  entries: Entry[]
  seen: [key: string, seen: { firstAt: number; count: number; awaitingSelf: boolean }][]
}

/** A name caught from an interim result, until the final words confirm or withdraw it (PT). */
export interface TentativeName {
  readonly name: string
}

interface Hearing {
  name: string
  at: number
  how: Introduced
  tentative: boolean
}

type Seen = { firstAt: number; count: number; awaitingSelf: boolean }

export class HeldNames {
  /** The names as a restart left them (P9); every name heard since is reckoned on top, in the order heard. */
  private base: HeldNamesState = { entries: [], seen: [] }
  /** Every name heard since the base, confirmed or tentative, in the order heard. */
  private heard: Hearing[] = []

  /** The held names in the order heard, as the names page lists them: tentative ones too, while they stand. */
  list(): string[] {
    return this.reckon(true).entries.map((e) => e.label)
  }

  /** Only the names the provider's final words have given: what the promise detector reads and a conversation ends with. */
  confirmedList(): string[] {
    return this.reckon(false).entries.map((e) => e.label)
  }

  /** A name caught at clock time `at` (ms), given `how` (D132; anything but a self-introduction after "meet X" follows D87). */
  hear(name: string, at: number, how: Introduced = 'other'): HeardName {
    const hearing: Hearing = { name, at, how, tentative: false }
    this.heard.push(hearing)
    return this.reckon(true).results.get(hearing)!
  }

  /** A name caught from an interim result (PT): held, and shown, until confirm() or withdraw(). */
  hearTentative(name: string, at: number, how: Introduced = 'other'): { heard: HeardName; ref: TentativeName } {
    const hearing: Hearing = { name, at, how, tentative: true }
    this.heard.push(hearing)
    return { heard: this.reckon(true).results.get(hearing)!, ref: hearing }
  }

  /** The final words gave the name too: it is held for good, as it was heard. What it reads as now. */
  confirm(ref: TentativeName): HeardName | undefined {
    const hearing = this.heard.find((h) => h === ref)
    if (!hearing) return undefined
    hearing.tentative = false
    return this.reckon(true).results.get(hearing)
  }

  /** The final words did not give the name: it goes, as if never heard. */
  withdraw(ref: TentativeName): void {
    const i = this.heard.findIndex((h) => h === ref && h.tentative)
    if (i !== -1) this.heard.splice(i, 1)
  }

  clear(): void {
    this.base = { entries: [], seen: [] }
    this.heard = []
  }

  /** What a restart must find (D73): the confirmed names in the order heard, and when each was first heard, so D87's window runs on across it. */
  snapshot(): HeldNamesState {
    const { entries, seen } = this.reckon(false)
    return { entries, seen: [...seen].map(([key, s]) => [key, { ...s }]) }
  }

  /** The names as a snapshot left them (P9). */
  restore(state: HeldNamesState): void {
    this.base = { entries: state.entries.map((e) => ({ ...e })), seen: state.seen.map(([key, seen]) => [key, { ...seen }]) }
    this.heard = []
  }

  /** The held names from the base and every name heard since (tentative ones only if asked), with what each hearing showed. */
  private reckon(withTentative: boolean): { entries: Entry[]; seen: Map<string, Seen>; results: Map<Hearing, HeardName> } {
    const entries = this.base.entries.map((e) => ({ ...e }))
    const seen = new Map(this.base.seen.map(([key, s]) => [key, { ...s }]))
    const results = new Map<Hearing, HeardName>()
    for (const h of this.heard) if (withTentative || !h.tentative) results.set(h, apply(entries, seen, h))
    return { entries, seen, results }
  }
}

/** One name heard, onto the held names (D87, D88, D132). */
function apply(entries: Entry[], seen: Map<string, Seen>, { name, at, how }: Hearing): HeardName {
  const key = name.toLowerCase()
  const s = seen.get(key)
  if (!s) {
    seen.set(key, { firstAt: at, count: 1, awaitingSelf: how === 'meet' })
    entries.push({ name, label: name })
    return { line: name, added: true }
  }
  const inWindow = at - s.firstAt <= REPEATED_NAME_WINDOW_MS
  // D132: the person "meet X" named, now introducing themselves.
  if (inWindow && how === 'self' && s.awaitingSelf) {
    s.awaitingSelf = false
    return { line: name, added: false }
  }
  s.awaitingSelf = false
  if (inWindow) {
    s.count += 1
    const label = `${name} (${s.count})`
    entries.push({ name, label })
    return { line: label, added: true }
  }
  return { line: name, added: false }
}
