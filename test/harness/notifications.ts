import type { Clock } from '../../shared/clock.ts'
import type { Notifier, PhoneNotification } from '../../server/src/notify.ts'

// The notification capture: the phones' OS as far as the server can tell.
// "The phone shows a notification" binds to `received` (what the OS took),
// never to the server's own log. Each notification is addressed to one
// account's phone (D79), so `phone(account)` is what that phone shows. While
// `reachable` is false the phones are off: sends are refused and recorded as
// attempts, and the server must try again (D114).

export interface Captured {
  /** The fixture clock when the server sent it (ms). */
  at: number
  /** The account whose phone it was sent to (the server's wearer key). */
  to: string
  notification: PhoneNotification
}

/** A notification as the phone shows it: its lines, title first. */
export const linesOf = (n: PhoneNotification) => [n.title, ...n.body.split('\n')].filter((l) => l !== '')

export class NotificationCapture implements Notifier {
  readonly received: Captured[] = []
  readonly refused: Captured[] = []
  reachable = true

  private clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  async send(to: string, notification: PhoneNotification): Promise<boolean> {
    const entry = { at: this.clock.now(), to, notification: structuredClone(notification) }
    ;(this.reachable ? this.received : this.refused).push(entry)
    return this.reachable
  }

  /** What the phone of `account` has received, in order. */
  phone(account: string): Captured[] {
    return this.received.filter((c) => c.to === account)
  }

  reset(clock: Clock): void {
    this.clock = clock
    this.received.length = 0
    this.refused.length = 0
    this.reachable = true
  }
}
