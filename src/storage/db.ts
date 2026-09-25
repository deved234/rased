// SQLite access via the Node.js builtin `node:sqlite` (DatabaseSync).
// No native addons, no WASM bundle: works identically in dev, tests and the
// packaged app on Electron 44 (Node 24). All access is synchronous and goes
// through small repositories with parameterized statements only.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyMigrations } from './migrations.js'

export type Db = DatabaseSync

export function openDatabase(filePath: string): Db {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  applyMigrations(db)
  return db
}

export function closeDatabase(db: Db): void {
  db.close()
}

export function utcNowIso(): string {
  return new Date().toISOString()
}
