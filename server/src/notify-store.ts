import type { OutboxStore, PhoneNotification } from './notify.ts'
import type { Store } from './store.ts'

// The outbox's notifications waiting for their phone, kept in the store (P9,
// D114): one row per notification, addressed to its account (D79), in the
// order queued, removed once that phone has taken it. A notification carries
// the conversation's promises as commands, or "Kept: conversation with Ana",
// never a word of the transcript (D76).
//
// A notification's number is never given twice (head-2): SQLite would hand a
// deleted newest row's number (D134) to the next one, and a send that answers
// after the delete would then take the newer notification's stored copy with
// it. The table's high-water mark is kept in the store's meta table, the
// number alone, as the conversations' and promises' are (phone/history.ts).
const HIGH_WATER = 'outbox_high_water'

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
    const db = this.store.db
    db.exec('SAVEPOINT outbox_add')
    try {
      const kept = db.prepare('SELECT value FROM meta WHERE key = ?').get(HIGH_WATER) as { value: string } | undefined
      const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM outbox').get() as { n: number }).n
      const id = Math.max(Number(kept?.value ?? 0) || 0, max) + 1
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(HIGH_WATER, String(id))
      db.prepare('INSERT INTO outbox (id, wearer, notification) VALUES (?, ?, ?)').run(id, to, JSON.stringify(notification))
      db.exec('RELEASE outbox_add')
      return id
    } catch (err) {
      db.exec('ROLLBACK TO outbox_add')
      db.exec('RELEASE outbox_add')
      throw err
    }
  }

  remove(id: number): void {
    this.store.db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
  }

  /**
   * Every notification still waiting for the phone of `to` that opens
   * `conversation` (its promises, or its kept jogger) goes: the conversation
   * was deleted on the phone page (D134). The caller scrubs the file after.
   */
  removeConversation(to: string, conversation: number): void {
    this.store.db.prepare("DELETE FROM outbox WHERE wearer = ? AND json_extract(notification, '$.data.conversation') = ?").run(to, String(conversation))
  }

  all(): { id: number; to: string; notification: PhoneNotification }[] {
    const rows = this.store.db.prepare('SELECT id, wearer, notification FROM outbox ORDER BY id').all() as { id: number; wearer: string; notification: string }[]
    return rows.map((r) => ({ id: r.id, to: r.wearer, notification: JSON.parse(r.notification) as PhoneNotification }))
  }

  clear(): void {
    this.store.db.exec('DELETE FROM outbox')
  }
}
