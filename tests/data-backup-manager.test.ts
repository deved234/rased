import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type Db } from '../src/storage/db.js'
import { DataBackupManager, isCorruptDatabaseError, recoverCorruptDatabase, recoverPendingRestore } from '../src/main/dataBackup.js'
import { createPortableBackup, inspectBackup } from '../src/storage/backups.js'
import { getSettingRaw, setSettingRaw } from '../src/storage/repositories.js'
import { defaultSettings } from '../src/shared/types.js'

const dirs: string[] = [], databases: Db[] = [], managers: DataBackupManager[] = []
const profile = (): string => { const dir = mkdtempSync(join(tmpdir(), 'rased-test-backup-')); dirs.push(dir); return dir }
function setup(): { db: Db; folder: string; manager: DataBackupManager } {
  const folder = profile(), db = openDatabase(join(folder, 'rased.db')), manager = new DataBackupManager(db, folder, '0.7.0')
  databases.push(db); managers.push(manager)
  return { db, folder, manager }
}
afterEach(async () => { for (const manager of managers.splice(0)) await manager.close(); for (const db of databases.splice(0)) if (db.isOpen) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('Backup and restore lifecycle', () => {
  it('defaults to off, backs up when due, persists the schedule, and prunes only managed files', async () => {
    const { db, folder, manager } = setup()
    expect(manager.status().preferences.schedule).toBe('off')
    await manager.tick()
    expect(existsSync(join(folder, 'backups'))).toBe(false)
    expect(manager.preferences({ schedule: 'daily', keep: 3 })).toBe(true)
    expect(manager.preferences({ schedule: 'hourly', keep: 1 })).toBe(false)
    const dir = join(folder, 'backups'); mkdirSync(dir)
    for (let n = 0; n < 6; n++) writeFileSync(join(dir, `rased-auto-${n}-00000000-0000-0000-0000-00000000000${n}.rased-backup`), 'old fixture')
    writeFileSync(join(dir, 'manual.rased-backup'), 'do not delete')
    await manager.tick()
    expect(readdirSync(dir).filter(name => name.startsWith('rased-auto-'))).toHaveLength(3)
    expect(readFileSync(join(dir, 'manual.rased-backup'), 'utf8')).toBe('do not delete')
    const state = manager.status()
    expect(state.lastBackupAt).not.toBeNull()
    expect(inspectBackup(state.lastBackupPath!).counts.projects).toBe(0)
    await manager.tick()
    expect(manager.status().lastBackupPath).toBe(state.lastBackupPath)
    expect(new DataBackupManager(db, folder, '0.7.0').status().preferences).toEqual({ schedule: 'daily', keep: 3 })
  })

  it('validates a private copy, supports cancellation, and leaves the database unchanged before confirmation', async () => {
    const { db, folder, manager } = setup(), file = join(folder, 'source.rased-backup')
    await createPortableBackup(db, file, '0.7.0')
    const preview = await manager.validate(file)
    expect(preview.ok).toBe(true)
    expect(existsSync(join(folder, 'restore-staging', 'pending.json'))).toBe(false)
    manager.discard()
    await expect(manager.stage(preview.token!, false)).rejects.toThrow('preview-expired')
    expect(getSettingRaw(db, 'data-last-restore-id')).toBeNull()
  })

  it('rejects tampered staging and expired previews', async () => {
    const { db, folder } = setup(), file = join(folder, 'source.rased-backup')
    await createPortableBackup(db, file, '0.7.0')
    let clock = Date.now()
    const manager = new DataBackupManager(db, folder, '0.7.0', () => clock); managers.push(manager)
    let preview = await manager.validate(file)
    clock += 11 * 60_000
    await expect(manager.stage(preview.token!, false)).rejects.toThrow('preview-expired')
    preview = await manager.validate(file)
    writeFileSync(join(folder, 'restore-staging', preview.token + '.rased-backup'), 'tampered')
    await expect(manager.stage(preview.token!, false)).rejects.toThrow('bad-schema')
  })
  it('cancels an in-progress preview and removes abandoned private copies on next startup', async () => {
    const { db, folder, manager } = setup(), file = join(folder, 'source.rased-backup')
    await createPortableBackup(db, file, '0.7.0')
    const validating = manager.validate(file)
    manager.discard()
    await expect(validating).rejects.toThrow('preview-expired')
    const staging = join(folder, 'restore-staging')
    expect(readdirSync(staging)).toHaveLength(0)
    writeFileSync(join(staging, '00000000-0000-0000-0000-000000000000.rased-backup'), 'abandoned private copy')
    writeFileSync(join(staging, 'unrelated.txt'), 'keep')
    manager.start()
    expect(readdirSync(staging)).toEqual(['unrelated.txt'])
  })

  it('recovers after restart, creates an exact rollback opportunity, and never repeats a committed restore', async () => {
    const source = setup(), target = setup(), file = join(source.folder, 'source.rased-backup')
    setSettingRaw(source.db, 'app', JSON.stringify({ ...defaultSettings(), language: 'en', runAtStartup: true }))
    await createPortableBackup(source.db, file, '0.7.0')
    setSettingRaw(target.db, 'app', JSON.stringify({ ...defaultSettings(), language: 'ar', runAtStartup: false }))
    const preview = await target.manager.validate(file)
    await target.manager.stage(preview.token!, false)
    const marker = readFileSync(join(target.folder, 'restore-staging', 'pending.json'))
    await target.manager.close()
    await recoverPendingRestore(target.db, target.folder, '0.7.0')
    const restored = JSON.parse(getSettingRaw(target.db, 'app')!)
    expect(restored.language).toBe('en')
    expect(restored.runAtStartup).toBe(false)
    const result = JSON.parse(getSettingRaw(target.db, 'data-restore-result')!)
    expect(result.ok).toBe(true)
    expect(inspectBackup(result.rollbackPath).manifest.format).toBe('rased-backup')
    setSettingRaw(target.db, 'app', JSON.stringify({ ...restored, language: 'ar' }))
    writeFileSync(join(target.folder, 'restore-staging', 'pending.json'), marker)
    await recoverPendingRestore(target.db, target.folder, '0.7.0')
    expect(JSON.parse(getSettingRaw(target.db, 'app')!).language).toBe('ar')
  })

  it('keeps old data if a confirmed archive is corrupt at next boot', async () => {
    const { db, folder, manager } = setup(), file = join(folder, 'source.rased-backup')
    await createPortableBackup(db, file, '0.7.0')
    setSettingRaw(db, 'app', JSON.stringify({ ...defaultSettings(), language: 'en' }))
    const preview = await manager.validate(file)
    await manager.stage(preview.token!, false)
    writeFileSync(join(folder, 'restore-staging', preview.token + '.rased-backup'), 'corrupt')
    await manager.close()
    await recoverPendingRestore(db, folder, '0.7.0')
    expect(JSON.parse(getSettingRaw(db, 'app')!).language).toBe('en')
    expect(JSON.parse(getSettingRaw(db, 'data-restore-result')!).ok).toBe(false)
  })
  it('does not replace data when the rollback backup cannot be completed', async () => {
    const source = setup(), target = setup(), file = join(source.folder, 'source.rased-backup')
    setSettingRaw(source.db, 'app', JSON.stringify({ ...defaultSettings(), language: 'en' }))
    setSettingRaw(target.db, 'app', JSON.stringify({ ...defaultSettings(), language: 'ar' }))
    await createPortableBackup(source.db, file, '0.7.0')
    const preview = await target.manager.validate(file)
    await target.manager.stage(preview.token!, false)
    await target.manager.close()
    await recoverPendingRestore(target.db, target.folder, '0.7.0', async () => { throw Error('Synthetic disk failure') })
    expect(JSON.parse(getSettingRaw(target.db, 'app')!).language).toBe('ar')
    expect(JSON.parse(getSettingRaw(target.db, 'data-restore-result')!).error).toBe('rollback-failed')
    expect(getSettingRaw(target.db, 'data-last-restore-id')).toBeNull()
  })

  it('waits for an active backup on close and prevents overlapping operations', async () => {
    const { db, folder, manager } = setup()
    const saving = manager.create(join(folder, 'backup.rased-backup'))
    await expect(manager.validate(join(folder, 'missing'))).rejects.toThrow('busy')
    await manager.close(); await saving
    expect(db.isOpen).toBe(true)
    expect(manager.status().lastBackupAt).not.toBeNull()
    await expect(manager.create(join(folder, 'another'))).rejects.toThrow('busy')
  })
  it('recovers a corrupt startup database while preserving its original bytes', async () => {
    const source = setup(), destination = profile(), archive = join(source.folder, 'archive.rased-backup')
    await createPortableBackup(source.db, archive, '0.7.0')
    const corrupt = 'Corrupt fixture database; preserve this original'
    writeFileSync(join(destination, 'rased.db'), corrupt)
    try { openDatabase(join(destination, 'rased.db')); expect.fail('Expected corrupt database') } catch (error) { expect(isCorruptDatabaseError(error)).toBe(true) }
    const restored = await recoverCorruptDatabase(destination, archive); databases.push(restored)
    const result = JSON.parse(getSettingRaw(restored, 'data-restore-result')!)
    expect(result.ok).toBe(true)
    expect(readFileSync(join(result.originalFilesPath, 'rased.db'), 'utf8')).toBe(corrupt)
    expect(restored.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 0 })
  })
  it('waits a full week between weekly backups', async () => {
    const { db, folder } = setup()
    let clock = Date.now()
    const manager = new DataBackupManager(db, folder, '0.7.0', () => clock); managers.push(manager)
    manager.preferences({ schedule: 'weekly', keep: 3 })
    await manager.tick()
    const first = manager.status().lastBackupPath
    clock += 6 * 86400000
    await manager.tick()
    expect(manager.status().lastBackupPath).toBe(first)
    clock += 86400000
    await manager.tick()
    expect(manager.status().lastBackupPath).not.toBe(first)
  })
  it('backs off failed automatic attempts for at least thirty minutes', async () => {
    const { db, folder } = setup()
    let clock = Date.now()
    const manager = new DataBackupManager(db, folder, '0.7.0', () => clock); managers.push(manager)
    manager.preferences({ schedule: 'daily', keep: 3 })
    await expect(manager.create(join(folder, 'rased.db'))).rejects.toThrow('protected-location')
    await manager.tick()
    expect(existsSync(join(folder, 'backups'))).toBe(false)
    clock += 31 * 60_000
    await manager.tick()
    expect(manager.status().lastBackupError).toBeNull()
    expect(manager.status().lastBackupAt).not.toBeNull()
  })
  it('never replaces a corrupt database with an invalid recovery archive', async () => {
    const folder = profile(), corrupt = 'Keep original bytes'
    writeFileSync(join(folder, 'rased.db'), corrupt)
    writeFileSync(join(folder, 'invalid.rased-backup'), 'not a backup')
    await expect(recoverCorruptDatabase(folder, join(folder, 'invalid.rased-backup'))).rejects.toThrow()
    expect(readFileSync(join(folder, 'rased.db'), 'utf8')).toBe(corrupt)
    expect(isCorruptDatabaseError({ errcode: 5 })).toBe(false)
  })
})
