import { DatabaseSync } from 'node:sqlite'

// The store reader: the SQLite file read directly, read-only, never through
// the server. "The team, reading the server, finds no transcript" binds to
// `find` over every table, not to the API whose job is to delete.

export interface Hit {
  table: string
  column: string
  value: string
}

function withStore<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

export function tables(path: string): string[] {
  return withStore(path, (db) =>
    (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  )
}

export function rows(path: string, table: string): Record<string, unknown>[] {
  if (!tables(path).includes(table)) throw new Error(`the store has no table ${table}`)
  return withStore(path, (db) => db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[])
}

/** Every text or blob value in any table that contains `text`, case-insensitively. */
export function find(path: string, text: string): Hit[] {
  const needle = text.toLowerCase()
  const hits: Hit[] = []
  for (const table of tables(path)) {
    for (const row of rows(path, table)) {
      for (const [column, raw] of Object.entries(row)) {
        const value = raw instanceof Uint8Array ? Buffer.from(raw).toString('utf8') : typeof raw === 'string' ? raw : undefined
        if (value?.toLowerCase().includes(needle)) hits.push({ table, column, value })
      }
    }
  }
  return hits
}
