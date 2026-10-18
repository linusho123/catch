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
// screen, which has them all (`data.conversation`). The second line, owed to
// the wearer, comes with P5. Every notification waits in the outbox until the
// phone takes it, however long that is (D114), tried again every
// NOTIFY_RETRY_MS on the injected clock.

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

/**
 * The notification for a conversation that ended with the wearer's promises
 * (`you`, as commands), or undefined when it produced none (D51: no
 * notification at all).
 */
export function promiseNotification(conversation: number | undefined, you: readonly string[]): PhoneNotification | undefined {
  if (you.length === 0) return undefined
  const [first, ...rest] = you
  const line = listOf([first!, ...rest.map((c) => c.charAt(0).toLowerCase() + c.slice(1))])
  return { title: 'Catch', body: cutLine(line), ...(conversation === undefined ? {} : { data: { conversation: String(conversation) } }) }
}

/** The notifications not yet taken by their phone, oldest first, each tried again until it is (D114). */
export class Outbox {
  private readonly queue: { to: string; notification: PhoneNotification }[] = []
  private readonly notifier: Notifier
  private readonly clock: Clock
  private retry: TimerHandle | undefined
  private sending = false
  private closed = false

  constructor(notifier: Notifier, clock: Clock) {
    this.notifier = notifier
    this.clock = clock
  }

  /** Notifications waiting for their phone. */
  get waiting(): number {
    return this.queue.length
  }

  /** Queues `notification` for the phone of `to` and tries it at once. */
  enqueue(to: string, notification: PhoneNotification): void {
    this.queue.push({ to, notification })
    if (!this.retry) void this.flush()
  }

  close(): void {
    this.closed = true
    this.forget()
  }

  /** Drops every waiting notification, as a restart of the process would (P9 makes them survive one). */
  forget(): void {
    this.queue.length = 0
    if (this.retry) this.clock.clearTimeout(this.retry)
    this.retry = undefined
  }

  /** Sends from the head, in order; the first the phone does not take waits, with all behind it, for the next try. */
  private async flush(): Promise<void> {
    if (this.sending || this.closed) return
    this.sending = true
    try {
      while (this.queue.length > 0 && !this.closed) {
        const { to, notification } = this.queue[0]!
        let taken = false
        try {
          taken = await this.notifier.send(to, notification)
        } catch {
          taken = false
        }
        if (!taken) {
          this.retry = this.clock.setTimeout(() => {
            this.retry = undefined
            void this.flush()
          }, NOTIFY_RETRY_MS)
          return
        }
        this.queue.shift()
      }
    } finally {
      this.sending = false
    }
  }
}
