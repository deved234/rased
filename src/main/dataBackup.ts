import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openDatabase, type Db } from '../storage/db.js'
import { backupCounts, createPortableBackup, finalizeBackup, inspectBackup, MAX_BACKUP_BYTES, restoreDatabase, type InspectedBackup } from '../storage/backups.js'
import { getSettingRaw, setSettingRaw } from '../storage/repositories.js'
import { sanitizeBackupPreferences, type BackupPreferences, type DataStatus, type RestorePreview } from '../shared/data.js'

const readJson = <T>(db: Db, key: string, fallback: T): T => { try { return JSON.parse(getSettingRaw(db, key) ?? 'null') as T ?? fallback } catch { return fallback } }
const restoreFolder = (profile: string): string => join(profile, 'restore-staging')
const markerPath = (profile: string): string => join(restoreFolder(profile), 'pending.json')
const managedName = (kind: 'auto' | 'before-restore'): string => `rased-${kind}-${Date.now()}-${randomUUID()}.rased-backup`
export function backupError(error: unknown, fallback = 'bad-schema'): string {
  const code = error instanceof Error ? error.message : ''
  return ['too-large', 'newer-schema', 'bad-schema', 'protected-location', 'busy', 'preview-expired', 'backup-failed', 'rollback-failed'].includes(code) ? code : fallback
}
async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export class DataBackupManager {
  private active: Promise<unknown> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private staged = false
  private previewEpoch = 0
  private preview: { token: string; path: string; hash: string; at: number } | null = null
  constructor(private db: Db, private profile: string, private appVersion: string, private now: () => number = Date.now, private finalize: (file: string, version: string) => Promise<InspectedBackup> = async (file, version) => finalizeBackup(file, version)) {}
  status(): DataStatus {
    const saved = readJson<Partial<DataStatus>>(this.db, 'data-backup-state', {})
    return {
      preferences: sanitizeBackupPreferences(readJson(this.db, 'data-backup-preferences', null)) ?? { schedule: 'off', keep: 5 },
      busy: !!this.active || this.staged,
      lastBackupAt: saved.lastBackupAt ?? null, lastBackupPath: saved.lastBackupPath ?? null, lastBackupError: saved.lastBackupError ?? null,
      lastRestore: readJson(this.db, 'data-restore-result', null)
    }
  }
  preferences(value: unknown): boolean {
    const preferences = sanitizeBackupPreferences(value)
    if (!preferences || this.closed || this.staged) return false
    setSettingRaw(this.db, 'data-backup-preferences', JSON.stringify(preferences))
    return true
  }
  start(): void {
    const folder = restoreFolder(this.profile)
    if (existsSync(folder) && !existsSync(markerPath(this.profile))) {
      for (const entry of readdirSync(folder)) if (/^[a-f0-9-]{36}\.rased-backup$/.test(entry)) {
        try { rmSync(join(folder, entry), { force: true }) } catch { /* Private previews are retried at next startup. */ }
      }
    }
    this.timer = setInterval(() => { void this.tick().catch(() => {}) }, 60_000)
    this.timer.unref()
  }
  private run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active || this.closed || this.staged) return Promise.reject(Error('busy'))
    const active = job().finally(() => { if (this.active === active) this.active = null })
    this.active = active
    return active
  }
  async create(target: string): Promise<void> {
    return this.run(async () => {
      try {
        await createPortableBackup(this.db, target, this.appVersion, this.finalize)
        setSettingRaw(this.db, 'data-backup-state', JSON.stringify({ lastBackupAt: new Date(this.now()).toISOString(), lastBackupPath: target, lastBackupError: null }))
      } catch (error) {
        setSettingRaw(this.db, 'data-backup-state', JSON.stringify({ ...this.status(), lastBackupError: backupError(error, 'write-failed'), lastAttemptAt: this.now() }))
        throw error
      }
    })
  }
  async tick(): Promise<void> {
    if (this.closed || this.active || this.staged) return
    const state = this.status(), interval = state.preferences.schedule === 'daily' ? 86400000 : 7 * 86400000
    if (state.preferences.schedule === 'off') return
    const attempt = readJson<{ lastAttemptAt?: number }>(this.db, 'data-backup-state', {}).lastAttemptAt ?? 0
    if (state.lastBackupAt && this.now() - Date.parse(state.lastBackupAt) < interval || state.lastBackupError && this.now() - attempt < 30 * 60_000) return
    const target = join(this.profile, 'backups', managedName('auto'))
    await this.create(target)
    this.prune(state.preferences.keep)
  }
  prune(keep: BackupPreferences['keep']): void {
    const dir = join(this.profile, 'backups')
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter(name => /^rased-(?:auto|before-restore)-\d+-[a-f0-9-]{36}\.rased-backup$/.test(name))
      .map(name => ({ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs })).sort((a, b) => b.at - a.at)
    for (const file of files.slice(keep)) {
      try { rmSync(file.path) } catch { /* Locked backups can be pruned on a later cycle. */ }
    }
  }
  async validate(file: string): Promise<RestorePreview> {
    return this.run(async () => {
      this.discard()
      const epoch = this.previewEpoch
      if (!statSync(file).isFile() || statSync(file).size > MAX_BACKUP_BYTES) throw Error('too-large')
      const token = randomUUID(), folder = restoreFolder(this.profile), path = join(folder, token + '.rased-backup')
      mkdirSync(folder, { recursive: true })
      try {
        await copyFile(file, path)
        const info = inspectBackup(path)
        const hash = await digest(path)
        if (this.closed || this.previewEpoch !== epoch) throw Error('preview-expired')
        this.preview = { token, path, hash, at: this.now() }
        return { ok: true, token, createdAt: info.manifest.createdAt, appVersion: info.manifest.appVersion, incoming: info.counts, current: backupCounts(this.db), startupRequested: info.startupRequested }
      } catch (error) { rmSync(path, { force: true }); throw error }
    })
  }
  discard(): void {
    if (!this.staged) this.previewEpoch++
    if (this.preview && !this.staged) {
      try { rmSync(this.preview.path, { force: true }) } catch { /* Best effort private staging cleanup. */ }
      this.preview = null
    }
  }
  async stage(token: string, applyStartup: boolean): Promise<void> {
    return this.run(async () => {
      const preview = this.preview
      if (!preview || token !== preview.token || this.now() - preview.at > 10 * 60_000) throw Error('preview-expired')
      if (await digest(preview.path) !== preview.hash) throw Error('bad-schema')
      const marker = markerPath(this.profile), temporary = marker + '.tmp'
      writeFileSync(temporary, JSON.stringify({ token, hash: preview.hash, applyStartup }))
      renameSync(temporary, marker)
      this.staged = true
    })
  }
  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    if (this.active) await Promise.allSettled([this.active])
    this.discard()
  }
}

/** A confirmed restore runs on the next boot, before any collector or service. */
export async function recoverPendingRestore(db: Db, profile: string, appVersion: string, finalize?: (file: string, version: string) => Promise<InspectedBackup>): Promise<void> {
  const marker = markerPath(profile)
  if (!existsSync(marker)) return
  let path: string | null = null
  try {
    const pending = JSON.parse(readFileSync(marker, 'utf8')) as { token: string; hash: string; applyStartup: boolean }
    if (!/^[a-f0-9-]{36}$/.test(pending.token) || !/^[a-f0-9]{64}$/.test(pending.hash) || typeof pending.applyStartup !== 'boolean') throw Error('bad-schema')
    path = join(restoreFolder(profile), pending.token + '.rased-backup')
    if (getSettingRaw(db, 'data-last-restore-id') === pending.token) return
    if (await digest(path) !== pending.hash) throw Error('bad-schema')
    inspectBackup(path)
    const rollbackPath = join(profile, 'backups', managedName('before-restore'))
    try { await createPortableBackup(db, rollbackPath, appVersion, finalize) } catch { throw Error('rollback-failed') }
    setSettingRaw(db, 'data-backup-state', JSON.stringify({ lastBackupAt: new Date().toISOString(), lastBackupPath: rollbackPath, lastBackupError: null }))
    restoreDatabase(db, path, pending.applyStartup, pending.token, rollbackPath)
    try { new DataBackupManager(db, profile, appVersion).prune((sanitizeBackupPreferences(readJson(db, 'data-backup-preferences', null)) ?? { keep: 5 }).keep) } catch { /* Pruning failure must not misreport a committed restore. */ }
  } catch (error) {
    setSettingRaw(db, 'data-restore-result', JSON.stringify({ ok: false, at: new Date().toISOString(), error: backupError(error, 'restore-failed') }))
  } finally {
    // A committed restore ID prevents replay even if cleanup is interrupted.
    try { rmSync(marker, { force: true }); if (path) rmSync(path, { force: true }) } catch { /* Retried on the next launch. */ }
  }
}

export function isCorruptDatabaseError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'errcode' in error && typeof error.errcode === 'number' && [11, 26].includes(error.errcode & 255)
}

/** Recovery when the normal database cannot open. Originals are moved, never erased. */
export async function recoverCorruptDatabase(profile: string, archive: string): Promise<Db> {
  const id = randomUUID(), folder = join(profile, 'restore-staging'), source = join(folder, id + '.rased-backup'), candidate = join(folder, id + '.db')
  mkdirSync(folder, { recursive: true })
  const original = join(profile, 'rased.db'), preserved = join(profile, 'backups', 'recovery-' + Date.now() + '-' + id)
  let working: Db | null = null
  const moved: [string, string][] = []
  let installed = false
  try {
    if (statSync(archive).size > MAX_BACKUP_BYTES) throw Error('too-large')
    await copyFile(archive, source)
    inspectBackup(source)
    working = openDatabase(candidate)
    restoreDatabase(working, source, false, id, '')
    setSettingRaw(working, 'data-restore-result', JSON.stringify({ ok: true, at: new Date().toISOString(), originalFilesPath: preserved }))
    working.close(); working = null
    mkdirSync(preserved, { recursive: true })
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(original + suffix)) {
      const destination = join(preserved, 'rased.db' + suffix)
      renameSync(original + suffix, destination)
      moved.push([destination, original + suffix])
    }
    renameSync(candidate, original)
    installed = true
    const restored = openDatabase(original)
    try { rmSync(markerPath(profile), { force: true }) } catch { /* The selected recovery supersedes a pending restore. */ }
    return restored
  } catch (error) {
    working?.close(); working = null
    if (installed) {
      renameSync(original, candidate)
      for (const suffix of ['-wal', '-shm']) if (existsSync(original + suffix)) renameSync(original + suffix, candidate + suffix)
    }
    for (const [from, to] of moved.reverse()) renameSync(from, to)
    throw error
  } finally {
    working?.close()
    for (const path of [source, candidate, candidate + '-wal', candidate + '-shm']) {
      try { rmSync(path, { force: true }) } catch { /* Keep a locked recovery artifact for diagnosis. */ }
    }
  }
}
