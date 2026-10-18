import type { Clock } from '../../shared/clock.ts'
import type { Phone, PhoneRoot } from '../../apps/lens/src/phone.ts'

// The phone, as far as the phone page reaches it (D130): a stand-in for the
// page's root element in the Even app's WebView. Every screen the page draws
// is one write of markup into the root; the stand-in records each write,
// stamped with the clock, and "the wearer sees" on the phone reads those
// writes, never the page's own state. `rowsOn` and `sectionsOn` read a screen
// the way the wearer would: the day headings, each row's names, time, open
// count and kept mark; each section's promises.

export interface PhoneScreen {
  at: number
  markup: string
}

export class PhoneScreenRecord implements PhoneRoot {
  readonly screens: PhoneScreen[] = []
  private listeners: ((event: { target: unknown }) => void)[] = []
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  get innerHTML(): string {
    return this.screens.at(-1)?.markup ?? ''
  }

  set innerHTML(markup: string) {
    this.screens.push({ at: this.clock.now(), markup })
  }

  addEventListener(_type: 'click', listener: (event: { target: unknown }) => void): void {
    this.listeners.push(listener)
  }

  /** The wearer taps the element carrying `attribute` (and `value`, if given) on the screen showing now. */
  tap(attribute: string, value?: string): void {
    const shown = this.innerHTML
    const present = value === undefined ? new RegExp(`\\s${attribute}[\\s>=]`).test(shown) : shown.includes(`${attribute}="${value}"`)
    if (!present) throw new Error(`the phone shows nothing with ${attribute}${value === undefined ? '' : `="${value}"`} to tap`)
    const target = {
      closest: (selector: string) =>
        selector === `[${attribute}]` ? { getAttribute: (name: string) => (name === attribute ? (value ?? '') : null) } : null,
    }
    for (const listener of this.listeners) listener({ target })
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!)
const inner = (html: string, cls: string) => html.match(new RegExp(`<span class="${cls}">(.*?)</span>`))?.[1]

export interface PhoneRow {
  /** The day heading the row sits under. */
  day: string
  conversation: string
  names: string
  /** The time shown, "2:10 pm". */
  time: string
  /** The instant the row's time stands for. */
  at: number
  open: string
  kept: boolean
}

/** The history's rows, top to bottom, each with the day heading above it. */
export function rowsOn(markup: string): PhoneRow[] {
  const out: PhoneRow[] = []
  for (const day of markup.matchAll(/<section class="day"><h2>(.*?)<\/h2><ul>(.*?)<\/ul><\/section>/g)) {
    for (const r of day[2]!.matchAll(/<li class="row" data-conversation="(\d+)">(.*?)<\/li>/g)) {
      const time = r[2]!.match(/<time datetime="([^"]+)">(.*?)<\/time>/)
      out.push({
        day: text(day[1]!),
        conversation: r[1]!,
        names: text(inner(r[2]!, 'names') ?? ''),
        time: time ? text(time[2]!) : '',
        at: time ? Date.parse(time[1]!) : Number.NaN,
        open: text(inner(r[2]!, 'open') ?? ''),
        kept: r[2]!.includes('<span class="kept">'),
      })
    }
  }
  return out
}

/** Whether the screen is the history. */
export const isHistory = (markup: string) => markup.startsWith('<main class="phone history">')

/** A conversation screen's sections: each heading with its promises' text and whether each tick box can be ticked. */
export function sectionsOn(markup: string): { title: string; promises: { text: string; tickable: boolean }[] }[] {
  return [...markup.matchAll(/<section class="(?:you|owed)"><h2>(.*?)<\/h2><ul>(.*?)<\/ul><\/section>/g)].map((s) => ({
    title: text(s[1]!),
    promises: [...s[2]!.matchAll(/<li class="promise">(.*?)<\/li>/g)].map((p) => ({
      text: text(p[1]!),
      tickable: /<input type="checkbox"/.test(p[1]!) && !/<input type="checkbox" disabled/.test(p[1]!),
    })),
  }))
}

/** The phone page started against the harness's server, drawing into a fresh record. */
export async function openPhone(opts: { server: string; token: string; clock: Clock }): Promise<{ phone: Phone; record: PhoneScreenRecord }> {
  const { startPhone } = await import('../../apps/lens/src/phone.ts')
  const record = new PhoneScreenRecord(opts.clock)
  const phone = startPhone({ root: record, server: opts.server, token: opts.token, now: () => opts.clock.now() })
  return { phone, record }
}
