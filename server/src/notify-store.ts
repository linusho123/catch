import type { OutboxStore, PhoneNotification } from './notify.ts'
import type { Store } from './store.ts'

// The outbox's notifications waiting for their phone, kept in the store (P9,
// D114): one row per notification, addressed to its account (D79), in the
// order queued, removed once that phone has taken it. A notification carries
// the conversation's promises as commands, or "Kept: conversation with Ana",
// never a word of the transcript (D76).

export class StoredOutbox implements OutboxStore {
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY,
        wearer TEXT NOT NULL,
        notification TEXT NOT NULL
      );
    `)
  }

  add(to: string, notification: PhoneNotification): number {
    const { lastInsertRowid } = this.store.db.prepare('INSERT INTO outbox (wearer, notification) VALUES (?, ?)').run(to, JSON.stringify(notification))
    return Number(lastInsertRowid)
  }

  remove(id: number): void {
    this.store.db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
  }

  all(): { id: number; to: string; notification: PhoneNotification }[] {
    const rows = this.store.db.prepare('SELECT id, wearer, notification FROM outbox ORDER BY id').all() as { id: number; wearer: string; notification: string }[]
    return rows.map((r) => ({ id: r.id, to: r.wearer, notification: JSON.parse(r.notification) as PhoneNotification }))
  }

  clear(): void {
    this.store.db.exec('DELETE FROM outbox')
  }
}
