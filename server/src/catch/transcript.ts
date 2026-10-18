import type { Store } from '../store.ts'

// The open conversation's transcript, held in the store while the
// conversation runs (D73: so the jogger can be written, and so a restart in
// P9 finds it) and deleted at its end, kept or not (D76: nothing of an unkept
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
   * Every wearer's transcript goes: the pre-P9 rule for a restart (fix round,
   * risk-1). Before P9 no session survives the process, so a conversation the
   * last process was holding has ended, and its words must not wait on the
   * volume for that wearer's next end (D76), nor join the next conversation's
   * words. The server calls it as it starts, and forgetWearers, the stand-in
   * for a restart, calls it too. P9's resume replaces it: a restart then
   * finds the open conversation and its transcript where it left them.
   */
  purge(): void {
    this.store.db.exec('DELETE FROM transcript')
    this.scrub()
  }

  /** The deleted words are overwritten in the file (secure_delete, store.ts), and the write-ahead log that held them is emptied too. */
  private scrub(): void {
    this.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }
}
