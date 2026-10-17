import type { Clock } from '../../shared/clock.ts'
import type { Notifier, PhoneNotification } from '../../server/src/notify.ts'

// The notification capture: the phone's OS as far as the server can tell.
// "The phone shows a notification" binds to `received` (what the OS took),
// never to the server's own log. While `reachable` is false the phone is off:
// sends are refused and recorded as attempts, and the server must try again.

export interface Captured {
  /** The fixture clock when the server sent it (ms). */
  at: number
  notification: PhoneNotification
}

export class NotificationCapture implements Notifier {
  readonly received: Captured[] = []
  readonly refused: Captured[] = []
  reachable = true

  private clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  async send(notification: PhoneNotification): Promise<boolean> {
    const entry = { at: this.clock.now(), notification: structuredClone(notification) }
    ;(this.reachable ? this.received : this.refused).push(entry)
    return this.reachable
  }

  reset(clock: Clock): void {
    this.clock = clock
    this.received.length = 0
    this.refused.length = 0
    this.reachable = true
  }
}
