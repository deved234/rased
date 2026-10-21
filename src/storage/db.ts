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
  try {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA busy_timeout = 5000;')
    db.exec('PRAGMA foreign_keys = ON;')
    applyMigrations(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function closeDatabase(db: Db): void {
  db.close()
}

/** Windows may briefly retain a mapped WAL sidecar after a forced exit.
 * Retry only the two observed mapping/truncation codes; never delete sidecars
 * or treat corrupt databases, permissions or arbitrary disk errors as transient.
 */
export async function openDatabaseAtStartup(filePath: string, open: (file: string) => Db = openDatabase, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), platform = process.platform, retried: (code: number, attempt: number) => void = () => {}): Promise<Db> {
  const delays = [250, 750, 1500]
  for (let attempt = 0; ; attempt++) {
    try { return open(filePath) }
    catch (error) {
      const code = error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) : 0
      const delay = delays[attempt]
      if (platform !== 'win32' || ![1546, 4874].includes(code) || delay === undefined) throw error
      retried(code, attempt + 1)
      await wait(delay)
    }
  }
}

export function utcNowIso(): string {
  return new Date().toISOString()
}
