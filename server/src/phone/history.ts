import type { ConversationResponse, HistoryResponse, JoggerResponse, PhonePromise } from '../../../shared/phone-protocol.ts'
import type { Store } from '../store.ts'

// The phone's history in the store (D100, D98): one row per ended
// conversation that produced a promise or a keep, with its names, its times
// and its promises in two sections. A conversation that produced neither is
// never written: nothing of it survives (D76), so it can never appear on the
// phone (D100). Each conversation belongs to one wearer (D79), keyed as the
// server keys its sessions, by the digest of the shared token.
//
// The server writes a conversation once, as it ends (app.ts, from the
// session's end), and a kept one's jogger once it is written (D99, D116). The
// phone API (api.ts) reads, and writes two things: a promise ticked off on the
// phone page (D39, P7), `done` set once and never unset, in the same file, so
// a tick outlives a reload and a restart; and a conversation deleted from its
// screen there (D134), which takes its row, its names, its promises of both
// kinds with their ticks and its jogger, in one transaction with whatever
// else the server deletes with it (the outbox's waiting notifications).
//
// A number, once given to a conversation or a promise, is never given again
// (D134): SQLite would hand a deleted newest row's number to the next one, so
// a retried delete, a late tick or an old notification naming the deleted
// one would reach a newer one. Each table's high-water mark is kept in the
// store's meta table, the number alone, nothing of what it numbered.

/** A conversation as it ends, with what it leaves for the phone. P2a fills `you`, P4 `kept`, P5 `owed`. */
export interface ConversationRecord {
  startedAt: number
  endedAt: number
  /** The names caught, in the order heard. */
  names: string[]
  /** The wearer's promises as commands, in the order made. */
  you: string[]
  /** The promises owed to the wearer, in the order made. */
  owed: string[]
  kept: boolean
}

type Side = 'you' | 'owed'

/** What a delete did (D134): `refused` is another wearer's conversation, never touched; `gone` one already deleted, or never there. */
export type DeleteOutcome = 'deleted' | 'gone' | 'refused'

/** The tables whose numbers are never given twice, and the meta key that holds each one's high-water mark. */
const NUMBERED = { conversations: 'conversations_high_water', promises: 'promises_high_water' } as const
type Numbered = keyof typeof NUMBERED

interface ConversationRow {
  id: number
  started_at: number
  ended_at: number
  names: string
  kept: number
}

interface PromiseRow {
  id: number
  conversation_id: number
  side: Side
  text: string
  done: number
}

export class History {
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY,
        wearer TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        names TEXT NOT NULL,
        kept INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS conversations_by_wearer ON conversations (wearer, started_at);
      CREATE TABLE IF NOT EXISTS promises (
        id INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations (id),
        side TEXT NOT NULL CHECK (side IN ('you', 'owed')),
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS promises_by_conversation ON promises (conversation_id);
      CREATE TABLE IF NOT EXISTS joggers (
        conversation_id INTEGER PRIMARY KEY REFERENCES conversations (id),
        bullets TEXT NOT NULL
      );
    `)
  }

  /**
   * An ended conversation. Written only when it produced a promise or a keep
   * (D76, D100); returns its id, or undefined when nothing of it is kept.
   */
  record(wearer: string, c: ConversationRecord): number | undefined {
    if (c.you.length === 0 && c.owed.length === 0 && !c.kept) return undefined
    const db = this.store.db
    db.exec('BEGIN')
    try {
      const id = this.nextNumber('conversations')
      db.prepare('INSERT INTO conversations (id, wearer, started_at, ended_at, names, kept) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        wearer,
        Math.round(c.startedAt),
        Math.round(c.endedAt),
        JSON.stringify(c.names),
        c.kept ? 1 : 0,
      )
      const insert = db.prepare('INSERT INTO promises (id, conversation_id, side, position, text) VALUES (?, ?, ?, ?, ?)')
      for (const side of ['you', 'owed'] as const) c[side].forEach((text, position) => insert.run(this.nextNumber('promises'), id, side, position, text))
      db.exec('COMMIT')
      return id
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /** The highest number `table` has ever given, kept as its high-water mark (and raised to any row a store written before the mark holds). */
  private highWater(table: Numbered): number {
    const db = this.store.db
    const kept = db.prepare('SELECT value FROM meta WHERE key = ?').get(NUMBERED[table]) as { value: string } | undefined
    const max = (db.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`).get() as { n: number }).n
    const mark = Math.max(Number(kept?.value ?? 0) || 0, max)
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(NUMBERED[table], String(mark))
    return mark
  }

  /** The next number for a row of `table`, never one given before; the mark moves to it. Inside the caller's transaction. */
  private nextNumber(table: Numbered): number {
    const id = this.highWater(table) + 1
    this.store.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(NUMBERED[table], String(id))
    return id
  }

  /**
   * Deletes one of the wearer's conversations (D134): its row, with its names
   * and times, its promises of both kinds (ticked or not) and its jogger, and
   * whatever `also` deletes with it, in one transaction: a failure anywhere
   * leaves it whole. Another wearer's is refused and never touched; one
   * already deleted (or never there) is quietly gone. The caller scrubs the
   * file once it is deleted (Store.scrub).
   */
  delete(wearer: string, id: number, also?: () => void): DeleteOutcome {
    const db = this.store.db
    const owner = db.prepare('SELECT wearer FROM conversations WHERE id = ?').get(id) as { wearer: string } | undefined
    if (!owner) return 'gone'
    if (owner.wearer !== wearer) return 'refused'
    db.exec('BEGIN')
    try {
      // The marks first: the numbers deleted here are never given again.
      this.highWater('conversations')
      this.highWater('promises')
      db.prepare('DELETE FROM promises WHERE conversation_id = ?').run(id)
      db.prepare('DELETE FROM joggers WHERE conversation_id = ?').run(id)
      db.prepare('DELETE FROM conversations WHERE id = ? AND wearer = ?').run(id, wearer)
      also?.()
      db.exec('COMMIT')
      return 'deleted'
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * The wearer's history, newest first, with each conversation's open promises and the total.
   * Open means the wearer's own (YOU) and not done; the owed ones are other people's to keep (operator answer 2).
   */
  list(wearer: string): HistoryResponse {
    const rows = this.store.db
      .prepare(
        `SELECT c.id, c.started_at, c.names, c.kept,
                (SELECT COUNT(*) FROM promises p WHERE p.conversation_id = c.id AND p.side = 'you' AND p.done = 0) AS open
           FROM conversations c
          WHERE c.wearer = ?
          ORDER BY c.started_at DESC, c.id DESC`,
      )
      .all(wearer) as unknown as (Pick<ConversationRow, 'id' | 'started_at' | 'names' | 'kept'> & { open: number })[]
    const conversations = rows.map((r) => ({ id: r.id, startedAt: r.started_at, names: JSON.parse(r.names) as string[], open: r.open, kept: r.kept === 1 }))
    return { open: conversations.reduce((sum, c) => sum + c.open, 0), conversations }
  }

  /** A kept conversation's jogger, written once (D99): the bullets in order. */
  recordJogger(conversation: number, bullets: readonly string[]): void {
    this.store.db.prepare('INSERT INTO joggers (conversation_id, bullets) VALUES (?, ?)').run(conversation, JSON.stringify(bullets))
  }

  /** One of the wearer's kept conversations' jogger; undefined when the wearer has no such conversation or no jogger is written. */
  jogger(wearer: string, id: number): JoggerResponse | undefined {
    const row = this.store.db
      .prepare(
        `SELECT c.id, c.started_at, c.ended_at, c.names, j.bullets
           FROM conversations c JOIN joggers j ON j.conversation_id = c.id
          WHERE c.id = ? AND c.wearer = ?`,
      )
      .get(id, wearer) as (Pick<ConversationRow, 'id' | 'started_at' | 'ended_at' | 'names'> & { bullets: string }) | undefined
    if (!row) return undefined
    return { id: row.id, startedAt: row.started_at, endedAt: row.ended_at, names: JSON.parse(row.names) as string[], bullets: JSON.parse(row.bullets) as string[] }
  }

  /**
   * Ticks one of the wearer's promises off (D39), YOU or OWED TO YOU, and
   * answers its conversation's screen as it now stands; undefined when the
   * wearer has no such promise (another wearer's is never touched).
   * Idempotent: a promise already done stays done, and nothing else changes.
   */
  tick(wearer: string, promise: number): ConversationResponse | undefined {
    const db = this.store.db
    const row = db
      .prepare('SELECT p.conversation_id AS id FROM promises p JOIN conversations c ON c.id = p.conversation_id WHERE p.id = ? AND c.wearer = ?')
      .get(promise, wearer) as { id: number } | undefined
    if (!row) return undefined
    db.prepare('UPDATE promises SET done = 1 WHERE id = ? AND done = 0').run(promise)
    return this.conversation(wearer, row.id)
  }

  /** A name added by hand on the phone page (D135), after those caught; undefined when the wearer has no such conversation. */
  addName(wearer: string, id: number, name: string): ConversationResponse | undefined {
    const db = this.store.db
    const c = db.prepare('SELECT names FROM conversations WHERE id = ? AND wearer = ?').get(id, wearer) as { names: string } | undefined
    if (!c) return undefined
    const names = JSON.parse(c.names) as string[]
    db.prepare('UPDATE conversations SET names = ? WHERE id = ?').run(JSON.stringify([...names, name]), id)
    return this.conversation(wearer, id)
  }

  /** A promise added by hand on the phone page (D135), the wearer's or owed to the wearer, after those there, open. */
  addPromise(wearer: string, id: number, side: Side, text: string): ConversationResponse | undefined {
    const db = this.store.db
    if (!db.prepare('SELECT 1 FROM conversations WHERE id = ? AND wearer = ?').get(id, wearer)) return undefined
    db.exec('BEGIN')
    try {
      const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM promises WHERE conversation_id = ? AND side = ?').get(id, side) as { n: number }).n
      db.prepare('INSERT INTO promises (id, conversation_id, side, position, text) VALUES (?, ?, ?, ?, ?)').run(this.nextNumber('promises'), id, side, position, text)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return this.conversation(wearer, id)
  }

  /** One of the wearer's conversations as its screen shows it; undefined when the wearer has no such conversation. */
  conversation(wearer: string, id: number): ConversationResponse | undefined {
    const db = this.store.db
    const c = db.prepare('SELECT id, started_at, ended_at, names, kept FROM conversations WHERE id = ? AND wearer = ?').get(id, wearer) as
      | ConversationRow
      | undefined
    if (!c) return undefined
    const promises = db
      .prepare('SELECT id, conversation_id, side, text, done FROM promises WHERE conversation_id = ? ORDER BY position, id')
      .all(id) as unknown as PromiseRow[]
    const of = (side: Side): PhonePromise[] => promises.filter((p) => p.side === side).map((p) => ({ id: p.id, text: p.text, done: p.done === 1 }))
    const jogger = db.prepare('SELECT 1 FROM joggers WHERE conversation_id = ?').get(id) !== undefined
    return { id: c.id, startedAt: c.started_at, endedAt: c.ended_at, names: JSON.parse(c.names) as string[], kept: c.kept === 1, you: of('you'), owed: of('owed'), jogger }
  }
}
