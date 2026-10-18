import type { Store } from '../store.ts'
import type { SessionState } from './session.ts'

// Each wearer's session as the store keeps it (P9, D73): one row per wearer
// (D79), the state session.ts hands over after every change, so a server that
// restarts takes up the open conversation where it stood. `open` says whether
// the row holds an open conversation, so the server can tell, as it starts,
// which transcript rows still belong to one (transcript.ts). The row holds no
// word of what was said: the transcript is its own table, deleted at the end
// (D76).

export interface SavedSession {
  wearer: string
  state: SessionState
}

export class SavedSessions {
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        wearer TEXT PRIMARY KEY,
        open INTEGER NOT NULL CHECK (open IN (0, 1)),
        state TEXT NOT NULL
      );
    `)
  }

  save(wearer: string, state: SessionState): void {
    this.store.db
      .prepare('INSERT INTO sessions (wearer, open, state) VALUES (?, ?, ?) ON CONFLICT (wearer) DO UPDATE SET open = excluded.open, state = excluded.state')
      .run(wearer, state.conversation ? 1 : 0, JSON.stringify(state))
  }

  /** Every wearer's saved session; a row that cannot be read is dropped, never fatal. */
  all(): SavedSession[] {
    const rows = this.store.db.prepare('SELECT wearer, state FROM sessions ORDER BY wearer').all() as { wearer: string; state: string }[]
    const out: SavedSession[] = []
    for (const row of rows) {
      try {
        const state = JSON.parse(row.state) as SessionState
        if (state.v === 1) out.push({ wearer: row.wearer, state })
        else this.forget(row.wearer)
      } catch {
        this.forget(row.wearer)
      }
    }
    return out
  }

  /** The wearers whose saved session holds an open conversation. */
  open(): string[] {
    return (this.store.db.prepare('SELECT wearer FROM sessions WHERE open = 1').all() as { wearer: string }[]).map((r) => r.wearer)
  }

  forget(wearer: string): void {
    this.store.db.prepare('DELETE FROM sessions WHERE wearer = ?').run(wearer)
  }

  /** Every wearer's goes (the harness's clean slate). */
  clear(): void {
    this.store.db.exec('DELETE FROM sessions')
  }
}
