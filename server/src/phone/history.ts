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
// session's end), and a kept one's jogger once it is written (D99, D116); the
// phone API (api.ts) only reads.

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
      const { lastInsertRowid } = db
        .prepare('INSERT INTO conversations (wearer, started_at, ended_at, names, kept) VALUES (?, ?, ?, ?, ?)')
        .run(wearer, Math.round(c.startedAt), Math.round(c.endedAt), JSON.stringify(c.names), c.kept ? 1 : 0)
      const id = Number(lastInsertRowid)
      const insert = db.prepare('INSERT INTO promises (conversation_id, side, position, text) VALUES (?, ?, ?, ?)')
      for (const side of ['you', 'owed'] as const) c[side].forEach((text, position) => insert.run(id, side, position, text))
      db.exec('COMMIT')
      return id
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
