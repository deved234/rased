import { defaultProfile, sanitizeProfileSet } from '../shared/proposalProfiles.js'
import { writeProfileSetTx } from './proposalProfiles.js'
import { clearQuickConsent } from './quickConsent.js'
import { backup, DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase, type Db } from './db.js'
import { SCHEMA_VERSION } from './migrations.js'
import { getSettingRaw, listSavedFilters, runInTransaction, setSettingRaw } from './repositories.js'
import { parseSettingsTransfer, settingsPayload } from './settingsTransfer.js'
import { sanitizeSettings } from '../shared/types.js'
import type { BackupCounts } from '../shared/data.js'
import { resetSearchCache } from './searchCache.js'

export const MAX_BACKUP_BYTES = 512 * 1024 * 1024
export const PORTABLE_KEYS = ['app', 'proposal-profile', 'proposal-profiles', 'ai-settings', 'kaf:last-list-ids', 'kaf:checkpoint']
const TABLES = ['projects', 'project_user_state', 'project_details', 'saved_filters', 'proposal_drafts', 'tombstones', 'source_state', 'notification_events', 'notification_batches'] as const
interface Manifest { format: 'rased-backup'; version: 1; schemaVersion: number; createdAt: string; appVersion: string }
export interface InspectedBackup { manifest: Manifest; counts: BackupCounts; startupRequested: boolean }

export function backupCounts(db: Db): BackupCounts {
  const count = (table: string, where = ''): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get() as { n: number }).n
  return { projects: count('projects'), notes: count('project_user_state', " WHERE note != ''"), drafts: count('proposal_drafts'), filters: count('saved_filters') }
}

function portableSettings(db: Db): void {
  const payload = settingsPayload(db)
  const checkpoint = ['kaf:last-list-ids', 'kaf:checkpoint'].map(key => [key, getSettingRaw(db, key)] as const)
  db.exec('DELETE FROM settings')
  setSettingRaw(db, 'app', JSON.stringify(sanitizeSettings(payload.settings)))
  writeProfileSetTx(db, payload.proposalProfiles!)
  setSettingRaw(db, 'ai-settings', JSON.stringify(payload.aiSettings))
  for (const [key, value] of checkpoint) if (value !== null) setSettingRaw(db, key, value)
}

function assertSeparateFile(db: Db, target: string): void {
  const files = db.prepare('PRAGMA database_list').all() as unknown as { file: string }[]
  for (const { file } of files) {
    if (!file) continue
    if ([file, file + '-wal', file + '-shm'].some(path => resolve(path).toLowerCase() === resolve(target).toLowerCase())) throw Error('protected-location')
    if (existsSync(target)) {
      const a = statSync(file), b = statSync(target)
      if (a.dev === b.dev && a.ino !== 0 && a.ino === b.ino) throw Error('protected-location')
    }
  }
}

/** SQLite's backup API includes live WAL data and yields between page batches. */
export async function createPortableBackup(db: Db, target: string, appVersion: string, finalize: (file: string, version: string) => Promise<InspectedBackup> = async (file, version) => finalizeBackup(file, version)): Promise<InspectedBackup> {
  assertSeparateFile(db, target)
  mkdirSync(dirname(target), { recursive: true })
  const temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await backup(db, temporary, { rate: 100 })
    const inspected = await finalize(temporary, appVersion)
    renameSync(temporary, target)
    return inspected
  } finally { rmSync(temporary, { force: true }) }
}

/** Runs off the Electron main thread in production. */
export function finalizeBackup(temporary: string, appVersion: string): InspectedBackup {
  const copy = new DatabaseSync(temporary)
  try {
    copy.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE;')
    runInTransaction(copy, () => {
      portableSettings(copy)
      copy.exec(`DELETE FROM diagnostics; DELETE FROM extension_jobs; DELETE FROM quick_apply_tickets; DELETE FROM notification_activations;
        DELETE FROM pending_classifications; DELETE FROM notification_batches;
        UPDATE notification_events SET status='suppressed' WHERE status IN ('pending','dispatching','uncertain');
        UPDATE notification_events SET session_id=NULL, batch_key=NULL;
        UPDATE source_state SET run_id=NULL;
        UPDATE project_details SET status='not_requested' WHERE status='loading';
        DROP TABLE IF EXISTS rased_backup_manifest;
        CREATE TABLE rased_backup_manifest (json TEXT NOT NULL);`)
      copy.exec("DELETE FROM project_search_cache; DELETE FROM project_search_body; INSERT INTO project_search_fts(project_search_fts) VALUES('delete-all'); DELETE FROM project_search_dirty; UPDATE project_search_state SET backfill_complete=0;")
      const manifest: Manifest = { format: 'rased-backup', version: 1, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), appVersion }
      copy.prepare('INSERT INTO rased_backup_manifest(json) VALUES(?)').run(JSON.stringify(manifest))
    })
    // Deleted credentials/tickets must not survive in free pages of the export.
    copy.exec('VACUUM')
  } finally { copy.close() }
  return inspectBackup(temporary)
}

let expectedSchema: Map<string, string> | null = null
function referenceSchema(): Map<string, string> {
  if (expectedSchema) return expectedSchema
  const reference = openDatabase(':memory:')
  try {
    expectedSchema = new Map((reference.prepare("SELECT name,sql FROM sqlite_schema WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%'").all() as unknown as { name: string; sql: string }[]).map(row => [row.name, row.sql.replace(/\s+/g, ' ').trim()]))
    return expectedSchema
  } finally { reference.close() }
}

function withBackup<T>(file: string, use: (db: Db) => T): T {
  if (!statSync(file).isFile()) throw Error('bad-schema')
  if (statSync(file).size > MAX_BACKUP_BYTES) throw Error('too-large')
  // SQLite reads the file directly; never buffer an entire large archive in JS.
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false })
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;')
    return use(db)
  } finally { db.close() }
}

export function inspectBackup(file: string): InspectedBackup {
  return withBackup(file, db => {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version > SCHEMA_VERSION) throw Error('newer-schema')
    // Schema 9 adds only non-portable notification activation tickets. Existing
    // schema-8 archives remain valid and contain every durable table we restore.
    if (![8,9,SCHEMA_VERSION].includes(version)) throw Error('bad-schema')
    const schema = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as unknown as { name: string; type: string; sql: string | null }[]
    const expected = new Map(referenceSchema())
    if (version === 8) expected.delete('notification_activations')
    if (version < 10) for (const name of expected.keys()) if (name.startsWith('project_search_') || name.startsWith('search_')) expected.delete(name)
    for (const item of schema) {
      if (!['table','index','trigger'].includes(item.type)) throw Error('bad-schema')
      if ((item.type === 'table' || item.type === 'trigger') && item.name !== 'rased_backup_manifest' && expected.get(item.name) !== item.sql?.replace(/\s+/g, ' ').trim()) throw Error('bad-schema')
      if (item.name === 'rased_backup_manifest' && item.sql?.replace(/\s+/g, ' ').trim() !== 'CREATE TABLE rased_backup_manifest (json TEXT NOT NULL)') throw Error('bad-schema')
    }
    for (const name of expected.keys()) if (!schema.some(item => item.name === name && ['table','trigger'].includes(item.type))) throw Error('bad-schema')
    if (version >= 10 && (db.prepare('SELECT 1 FROM project_search_cache LIMIT 1').get() || db.prepare('SELECT 1 FROM project_search_body LIMIT 1').get() || db.prepare('SELECT rowid FROM project_search_fts LIMIT 1').get() || db.prepare('SELECT 1 FROM project_search_dirty LIMIT 1').get())) throw Error('bad-schema')
    const rows = db.prepare('SELECT json FROM rased_backup_manifest').all() as unknown as { json: string }[]
    if (rows.length !== 1) throw Error('bad-schema')
    const manifest = JSON.parse(rows[0]!.json) as Manifest
    if (manifest.format !== 'rased-backup' || manifest.version !== 1 || manifest.schemaVersion !== version || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || typeof manifest.appVersion !== 'string' || manifest.appVersion.length > 50) throw Error('bad-schema')
    if (Object.values(db.prepare('PRAGMA integrity_check(1)').get() ?? {})[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) throw Error('bad-schema')
    if (db.prepare(`SELECT 1 FROM settings WHERE key NOT IN (${PORTABLE_KEYS.map(() => '?').join(',')}) LIMIT 1`).get(...PORTABLE_KEYS)) throw Error('bad-schema')
    if (db.prepare('SELECT 1 FROM extension_jobs LIMIT 1').get() || db.prepare('SELECT 1 FROM quick_apply_tickets LIMIT 1').get()) throw Error('bad-schema')
    if (version >= 9 && db.prepare('SELECT 1 FROM notification_activations LIMIT 1').get()) throw Error('bad-schema')
    const settings = JSON.parse(getSettingRaw(db, 'app') ?? 'null') as unknown
    const rawProfiles = getSettingRaw(db, 'proposal-profiles')
    const profiles = rawProfiles === null ? undefined : sanitizeProfileSet(JSON.parse(rawProfiles))
    if (profiles === null) throw Error('bad-schema')
    parseSettingsTransfer({ format: 'rased-settings', version: 3, ...(profiles ? { proposalProfiles: profiles } : { proposalProfile: JSON.parse(getSettingRaw(db, 'proposal-profile') ?? 'null') }), settings, savedFilters: listSavedFilters(db), aiSettings: JSON.parse(getSettingRaw(db, 'ai-settings') ?? 'null') })
    return { manifest, counts: backupCounts(db), startupRequested: sanitizeSettings(settings).runAtStartup }
  })
}

/** Called at boot before collectors/services exist; SQLite rolls back all tables on failure. */
export function restoreDatabase(db: Db, file: string, applyStartup: boolean, restoreId: string, rollbackPath: string): void {
  inspectBackup(file)
  const current = sanitizeSettings(JSON.parse(getSettingRaw(db, 'app') ?? '{}'))
  const cooldowns = db.prepare('SELECT * FROM source_state').all() as unknown as { source: string; backoff_until: string | null; consecutive_failures: number; last_error: string | null }[]
  db.prepare('ATTACH DATABASE ? AS restore_data').run(file)
  try {
    runInTransaction(db, () => {
      db.exec(`DELETE FROM pending_classifications; DELETE FROM extension_jobs; DELETE FROM quick_apply_tickets; DELETE FROM notification_activations;
        DELETE FROM notification_events; DELETE FROM notification_batches; DELETE FROM proposal_drafts;
        DELETE FROM project_details; DELETE FROM project_user_state; DELETE FROM projects;
        DELETE FROM saved_filters; DELETE FROM tombstones; DELETE FROM source_state;`)
      for (const table of TABLES) {
        const columns = (db.prepare(`PRAGMA main.table_info(${table})`).all() as unknown as { name: string }[]).map(row => `"${row.name}"`).join(',')
        db.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM restore_data.${table}`)
      }
      clearQuickConsent(db)
      for (const key of PORTABLE_KEYS) db.prepare('DELETE FROM settings WHERE key=?').run(key)
      db.exec('INSERT INTO main.settings SELECT * FROM restore_data.settings')
      const archived = JSON.parse(getSettingRaw(db, 'app')!)
      const rawProfiles = getSettingRaw(db, 'proposal-profiles')
      const profiles = rawProfiles === null ? null : sanitizeProfileSet(JSON.parse(rawProfiles))!
      // Replace the legacy mirror before validation can reset otherwise valid preferences.
      if (profiles) archived.quickApply = { ...archived.quickApply, template: defaultProfile(profiles).quickTemplate }
      const restored = sanitizeSettings(archived)
      restored.runAtStartup = applyStartup ? restored.runAtStartup : current.runAtStartup
      restored.quickApply.enabled = false
      restored.doNotDisturbUntil = current.doNotDisturbUntil
      restored.compactBounds = current.compactBounds
      restored.whatsNewSeen = current.whatsNewSeen
      setSettingRaw(db, 'app', JSON.stringify(restored))
      if (profiles) writeProfileSetTx(db, profiles)
      db.exec("UPDATE notification_events SET status='suppressed' WHERE status IN ('pending','dispatching','uncertain'); DELETE FROM pending_classifications;")
      for (const old of cooldowns) if (old.backoff_until && Date.parse(old.backoff_until) > Date.now()) {
        db.prepare(`INSERT INTO source_state(source,backoff_until,consecutive_failures,last_error) VALUES(?,?,?,?)
          ON CONFLICT(source) DO UPDATE SET backoff_until=MAX(COALESCE(backoff_until,''),excluded.backoff_until),
          consecutive_failures=MAX(consecutive_failures,excluded.consecutive_failures),last_error=excluded.last_error`).run(old.source, old.backoff_until, old.consecutive_failures, old.last_error)
      }
      setSettingRaw(db, 'data-last-restore-id', restoreId)
      setSettingRaw(db, 'data-restore-result', JSON.stringify({ ok: true, at: new Date().toISOString(), rollbackPath }))
      resetSearchCache(db)
    })
  } finally { db.exec('DETACH DATABASE restore_data') }
}
