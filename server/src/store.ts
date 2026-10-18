import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// The one-file SQLite store (DESIGN.md: chosen). On Fly the file lives on the
// `catch_data` volume at /data/catch.db; locally it defaults to ./data/catch.db.
// P0a opens it and records the schema version; later phases add their tables.

export const SCHEMA_VERSION = 1

export interface Store {
  readonly path: string
  readonly db: DatabaseSync
  schemaVersion(): number
  close(): void
}

export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  // D76: a deleted row's bytes are overwritten, so a transcript deleted at the boundary is gone from the file too.
  db.exec('PRAGMA secure_delete = ON')
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
  return {
    path,
    db,
    schemaVersion() {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined
      return row ? Number(row.value) : 0
    },
    close() {
      db.close()
    },
  }
}
