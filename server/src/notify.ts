// The notification sender's seam. The server hands each phone notification to
// a Notifier; `true` means the phone's OS received it, `false` that the phone
// was unreachable and the notification must wait (D114). Under test the
// harness's capture (test/harness/notifications.ts) is the phone; the real
// sender arrives with the notification semantics (P2a).

export interface PhoneNotification {
  title: string
  body: string
  data?: Record<string, string>
}

export interface Notifier {
  send(notification: PhoneNotification): Promise<boolean>
}
