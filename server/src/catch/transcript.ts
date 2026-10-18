import type { Store } from '../store.ts'

// The open conversation's transcript, held in the store while the
// conversation runs (D73: so the jogger can be written, and so a restart
// finds it, P9) and deleted at its end, kept or not (D76: nothing of an unkept
// conversation's transcript survives the boundary; P4's jogger is written
// from it before it goes). One row per word, keyed by the wearer (D79). No
// audio is ever stored: the PCM goes to the speech-to-text provider and
// nowhere else.

export interface TranscriptWord {
  text: string
  start: number
  end: number
  side: 'wearer' | 'other'
}

export class Transcript {
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS transcript (
        id INTEGER PRIMARY KEY,
        wearer TEXT NOT NULL,
        text TEXT NOT NULL,
        start REAL NOT NULL,
        "end" REAL NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('wearer', 'other'))
      );
      CREATE INDEX IF NOT EXISTS transcript_by_wearer ON transcript (wearer, id);
    `)
  }

  add(wearer: string, word: TranscriptWord): void {
    this.store.db.prepare('INSERT INTO transcript (wearer, text, start, "end", side) VALUES (?, ?, ?, ?, ?)').run(wearer, word.text, word.start, word.end, word.side)
  }

  /** The wearer's open conversation so far, in the order heard. */
  words(wearer: string): TranscriptWord[] {
    return this.store.db.prepare('SELECT text, start, "end", side FROM transcript WHERE wearer = ? ORDER BY id').all(wearer) as unknown as TranscriptWord[]
  }

  /** The conversation has ended: every word of it goes (D76). */
  delete(wearer: string): void {
    this.store.db.prepare('DELETE FROM transcript WHERE wearer = ?').run(wearer)
    this.scrub()
  }

  /**
   * Every wearer's transcript goes: the harness's clean slate (forgetWearers),
   * which drops every session and so every open conversation with it (D76).
   */
  purge(): void {
    this.store.db.exec('DELETE FROM transcript')
    this.scrub()
  }

  /**
   * Every transcript row that belongs to no open conversation goes, as the
   * server starts (P9, replacing P2a's purge of every row at start): the open
   * conversations of `open` are taken up again with their words, but a word
   * whose conversation has ended or whose saved session is gone (a crash
   * between a word and its session's save, a row that cannot be read) belongs
   * to nothing that will ever end it, so it must not wait on the volume (D76).
   */
  purgeExcept(open: readonly string[]): void {
    const db = this.store.db
    if (open.length === 0) db.exec('DELETE FROM transcript')
    else db.prepare(`DELETE FROM transcript WHERE wearer NOT IN (${open.map(() => '?').join(', ')})`).run(...open)
    this.scrub()
  }

  /** The deleted words are overwritten in the file (secure_delete, store.ts), and the write-ahead log that held them is emptied too. */
  private scrub(): void {
    this.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }
}
