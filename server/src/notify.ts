import type { Clock, TimerHandle } from '../../shared/clock.ts'

// The notification sender's seam, and the notification semantics (P2a). The
// server hands each phone notification to a Notifier, addressed to the
// account it belongs to (D79: one wearer per account, so a pair of glasses
// delivers to exactly one phone); `true` means that phone's OS received it,
// `false` that the phone was unreachable. Under test the harness's capture
// (test/harness/notifications.ts) is the phone; there is no push path yet, so
// the hosted server has no notifier and the phone page's history is how the
// promises reach the phone.
//
// One notification per conversation that produced promises (D28, D51): the
// wearer's promises as commands on its first line, "Send Dev the deck tonight
// and introduce Dev to Sam" (D117); a list too long for a line is cut off
// with an ellipsis, and opening the notification opens the conversation's
// screen, which has them all (`data.conversation`). The second line is the
// promises owed to the wearer, "Owed to you: Dev sends the agenda" (P5). A kept conversation sends a second notification
// once its jogger is written, "Kept: conversation with Ana", which opens the
// jogger (P4, D24). Every notification waits in the outbox until the
// phone takes it, however long that is (D114), tried again every
// NOTIFY_RETRY_MS on the injected clock. The outbox keeps what waits in the
// store too (OutboxStore, notify-store.ts), so a server that restarts sends
// it all the same, in order, once (P9): a notification leaves the store only
// when its phone has taken it.

export interface PhoneNotification {
  title: string
  /** The notification's lines, one per "\n". */
  body: string
  data?: Record<string, string>
}

export interface Notifier {
  /** Hands `notification` to the phone of the account `to` (the server's wearer key); true once that phone's OS has it. */
  send(to: string, notification: PhoneNotification): Promise<boolean>
}

/**
 * The longest line a notification carries before it is cut with an ellipsis
 * (D28): about two lines of an iPhone notification's body, so the first line
 * and P5's owed line both fit in the four the lock screen shows. A
 * presentation value, not a ruling.
 */
export const NOTIFICATION_LINE_CHARS = 90

/** How often a notification the phone did not take is tried again (D114: it waits however long it takes). */
export const NOTIFY_RETRY_MS = 10_000

/** "A", "A and B", "A, B and C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** A line cut at the last word that fits, with an ellipsis, when it is longer than `max` characters (D28). */
export function cutLine(line: string, max = NOTIFICATION_LINE_CHARS): string {
  if (line.length <= max) return line
  const room = line.slice(0, max - 1)
  const space = room.lastIndexOf(' ')
  return `${(space > 0 ? room.slice(0, space) : room).replace(/[,;:]$/, '')}…`
}

/** The second line's lead: the promises owed to the wearer (D28, D117). */
export const OWED_LEAD = 'Owed to you: '

/**
 * The notification for a conversation that ended with promises: the wearer's
 * (`you`, as commands) on its first line, those owed to the wearer (`owed`,
 * "Dev sends the agenda") on a second, "Owed to you: …" (D28, D117, P5); each
 * line cut on its own when it is too long. Undefined when nothing was promised
 * in either direction (D51: no notification at all).
 */
export function promiseNotification(conversation: number | undefined, you: readonly string[], owed: readonly string[] = []): PhoneNotification | undefined {
  if (you.length === 0 && owed.length === 0) return undefined
  const lines: string[] = []
  if (you.length > 0) {
    const [first, ...rest] = you
    lines.push(cutLine(listOf([first!, ...rest.map((c) => c.charAt(0).toLowerCase() + c.slice(1))])))
  }
  if (owed.length > 0) lines.push(cutLine(`${OWED_LEAD}${listOf(owed)}`))
  return { title: 'Catch', body: lines.join('\n'), ...(conversation === undefined ? {} : { data: { conversation: String(conversation) } }) }
}

/** Whether `zone` is a time zone this runtime knows (Intl throws a RangeError on one it does not). */
function knownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * CATCH_TIME_ZONE as the server uses it, checked once at startup (fix round,
 * risk-2): a zone the runtime does not know is named in a warning and the
 * server's own zone is used, so a typo never costs a kept notification.
 */
export function checkedTimeZone(zone: string | undefined, warn: (message: string) => void = console.warn): string | undefined {
  if (zone === undefined || knownTimeZone(zone)) return zone
  warn(`CATCH_TIME_ZONE is not a time zone this server knows (${JSON.stringify(zone)}): a kept notification with no name gives the time in the server's own zone`)
  return undefined
}

/**
 * The notification for a kept conversation whose jogger has been written
 * (D24): "Kept: conversation with Ana", or with the time it began when no
 * name was caught ("Kept: conversation at 2:10 pm", in `timeZone`, the
 * wearer's; the server's own when unset or unknown). The time is formatted
 * only when it is used (risk-2). Opening it opens the jogger
 * (`data.screen`). It queues like any other (D114).
 */
export function keptNotification(conversation: number, names: readonly string[], startedAt: number, timeZone?: string): PhoneNotification {
  const at = () => {
    const zone = timeZone !== undefined && knownTimeZone(timeZone) ? { timeZone } : {}
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...zone })
      .format(startedAt)
      .replace(/\s?([AP]M)$/, (_m, half: string) => ` ${half.toLowerCase()}`)
  }
  const line = `Kept: conversation ${names.length > 0 ? `with ${listOf([...names])}` : `at ${at()}`}`
  return { title: 'Catch', body: cutLine(line), data: { conversation: String(conversation), screen: 'jogger' } }
}

/** Where the outbox keeps what waits for a phone, so a restart loses none of it (P9, D114). */
export interface OutboxStore {
  /** Keeps `notification` for the phone of `to`; returns its id. */
  add(to: string, notification: PhoneNotification): number
  /** Its phone has taken it. */
  remove(id: number): void
  /** Everything still waiting, every account's, oldest first. */
  all(): { id: number; to: string; notification: PhoneNotification }[]
  /** Everything goes (the harness's clean slate). */
  clear(): void
}

/** One notification waiting, with its id in the store when there is one. */
interface Waiting {
  id?: number
  notification: PhoneNotification
}

/** One account's notifications not yet taken by its phone, oldest first, and its pending retry. */
interface PhoneQueue {
  items: Waiting[]
  retry: TimerHandle | undefined
  sending: boolean
}

/**
 * The notifications not yet taken by their phone, each tried again until it
 * is (D114). One queue per account (fix round, risk-4 a): each notification is
 * addressed to its own account's phone (D79), so a phone that is off holds
 * back only its own account's notifications, in order.
 */
export class Outbox {
  private queues = new Map<string, PhoneQueue>()
  private readonly notifier: Notifier
  private readonly clock: Clock
  private readonly store: OutboxStore | undefined
  private closed = false

  constructor(notifier: Notifier, clock: Clock, store?: OutboxStore) {
    this.notifier = notifier
    this.clock = clock
    this.store = store
  }

  /**
   * As the server starts (P9): every notification a previous process left
   * waiting is queued again for its phone, in order, and tried at once.
   */
  resume(): void {
    if (this.closed || !this.store) return
    for (const { id, to, notification } of this.store.all()) this.queue(to, { id, notification })
  }

  /** Notifications waiting for their phone, every account's. */
  get waiting(): number {
    let n = 0
    for (const q of this.queues.values()) n += q.items.length
    return n
  }

  /** Queues `notification` for the phone of `to` and tries it at once, unless that phone's queue is waiting for its retry. */
  enqueue(to: string, notification: PhoneNotification): void {
    if (this.closed) return
    const id = this.store?.add(to, notification)
    this.queue(to, { ...(id !== undefined ? { id } : {}), notification })
  }

  private queue(to: string, item: Waiting): void {
    let q = this.queues.get(to)
    if (!q) {
      q = { items: [], retry: undefined, sending: false }
      this.queues.set(to, q)
    }
    q.items.push(item)
    if (!q.retry) void this.flush(to, q)
  }

  /**
   * The notifications waiting in memory for the phone of `to` that open
   * `conversation` go (D134: it was deleted on the phone page; the store's
   * copies go in the delete's own transaction, notify-store.ts). One already
   * on its way to the phone cannot be called back, but whatever the phone
   * answers it is never tried again.
   */
  dropConversation(to: string, conversation: number): void {
    const q = this.queues.get(to)
    if (!q) return
    const id = String(conversation)
    q.items = q.items.filter((item) => item.notification.data?.conversation !== id)
  }

  /**
   * No notification is sent, and no retry armed, once closed (risk-4 c).
   * What waits stays in the store for the next process (P9).
   */
  close(): void {
    this.closed = true
    this.drop()
  }

  /**
   * Drops every waiting notification, in memory and in the store: the
   * harness's clean slate between scenarios, never a restart (a restart keeps
   * them, P9). A send still in flight belongs to a queue that is gone: when it
   * answers it touches nothing queued after this (risk-4 b).
   */
  forget(): void {
    this.drop()
    this.store?.clear()
  }

  /** The queues in memory go, with their retries. */
  private drop(): void {
    for (const q of this.queues.values()) {
      if (q.retry) this.clock.clearTimeout(q.retry)
      q.retry = undefined
    }
    this.queues = new Map()
  }

  /** Whether `q` is still the live queue of `to` (not forgotten, not closed). */
  private live(to: string, q: PhoneQueue): boolean {
    return !this.closed && this.queues.get(to) === q
  }

  /** Sends one account's queue from its head, in order; the first its phone does not take waits, with all behind it, for the next try. */
  private async flush(to: string, q: PhoneQueue): Promise<void> {
    if (q.sending || !this.live(to, q)) return
    q.sending = true
    try {
      while (q.items.length > 0 && this.live(to, q)) {
        const item = q.items[0]!
        let taken = false
        try {
          taken = await this.notifier.send(to, item.notification)
        } catch {
          taken = false
        }
        // Taken is taken, whatever happened meanwhile: it leaves the store, so no restart sends it twice (P9).
        if (taken && item.id !== undefined) {
          try {
            this.store?.remove(item.id)
          } catch {
            // The store closed as the phone answered: the next process sends it once more rather than never.
          }
        }
        // Forgotten or closed while the phone answered: this queue is gone, and nothing newer is ours to touch.
        if (!this.live(to, q)) return
        if (!taken) {
          q.retry = this.clock.setTimeout(() => {
            q.retry = undefined
            void this.flush(to, q)
          }, NOTIFY_RETRY_MS)
          return
        }
        if (q.items[0] === item) q.items.shift()
      }
      if (q.items.length === 0 && this.queues.get(to) === q) this.queues.delete(to)
    } finally {
      q.sending = false
    }
  }
}
