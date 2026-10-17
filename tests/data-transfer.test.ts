import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type Db } from '../src/storage/db.js'
import { defaultSettings } from '../src/shared/types.js'
import { importSettings, parseSettingsTransfer, settingsPayload, TRANSFER_SETTINGS_KEYS } from '../src/storage/settingsTransfer.js'
import { getSettingRaw, setSettingRaw, upsertProjectsBatch, updateUserState, upsertProjectDetails, saveSavedFilterRow } from '../src/storage/repositories.js'
import { createPortableBackup, inspectBackup, restoreDatabase } from '../src/storage/backups.js'
import { saveProposalDraft, getProposalDraft } from '../src/storage/proposalDrafts.js'
import { issueNotificationActivation, claimNotificationActivation } from '../src/storage/notificationActivations.js'

const folders: string[] = [], databases: Db[] = []
const profile = (): string => { const path = mkdtempSync(join(tmpdir(), 'rased-test-data-')); folders.push(path); return path }
const database = (folder = profile()): Db => { const db = openDatabase(join(folder, 'rased.db')); databases.push(db); return db }
const now = new Date().toISOString()
function seed(db: Db): void {
  upsertProjectsBatch(db, [{ source: 'mostaql', externalId: '44', url: 'https://mostaql.com/go/44', title: 'مشروع', descriptionExcerpt: 'مقتطف', publishedAt: now, publishedRaw: now }], { now, discoveryKind: 'initial' })
  updateUserState(db, 1, { note: 'ملاحظة شخصية', saved: true, status: 'submitted' }, now)
  upsertProjectDetails(db, 1, { text: 'تفاصيل كاملة', provenance: 'full', fetchedAt: now, status: 'ready', errorCode: null })
  saveProposalDraft(db, { projectId: 1, proposal: 'عرض محفوظ', assumptions: ['افتراض'], questions: ['سؤال'], updatedAt: now, provider: 'openai', model: 'example-model' })
  const prefs = { ...defaultSettings(), nafezlyKeywordsAny: ['React'], khamsatEnabled: false, khamsatExcludeKeywords: ['WordPress'], kafKeywordsAny: ['تصميم'], runAtStartup: true }
  setSettingRaw(db, 'app', JSON.stringify(prefs))
  setSettingRaw(db, 'proposal-profile', JSON.stringify({ skills: 'TypeScript', experience: 'خبرة حقيقية', portfolio: 'https://example.com/work', tone: 'concise', language: 'ar' }))
  setSettingRaw(db, 'ai-settings', JSON.stringify({ schemaVersion: 1, activeProvider: 'openai', modelByProvider: { gemini: 'gemini-2.5-flash', openai: 'example-model', anthropic: '' } }))
}
afterEach(() => { for (const db of databases.splice(0)) if (db.isOpen) db.close(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

describe('Portable settings', () => {
  it('accounts for every current setting and intentionally excludes only session/device state', () => {
    expect(Object.keys(defaultSettings()).filter(key => !TRANSFER_SETTINGS_KEYS.includes(key as typeof TRANSFER_SETTINGS_KEYS[number])).sort()).toEqual(['compactBounds', 'doNotDisturbUntil'])
  })
  it('round trips all source preferences, the professional profile and provider/model choices', () => {
    const source = database(), destination = database(); seed(source)
    setSettingRaw(source, 'private-key', 'DO_NOT_EXPORT')
    const payload = parseSettingsTransfer(JSON.parse(JSON.stringify(settingsPayload(source))))
    const imported = importSettings(destination, defaultSettings(), payload, 'replace', false)
    expect(imported.nafezlyKeywordsAny).toEqual(['React'])
    expect(imported.khamsatEnabled).toBe(false)
    expect(imported.khamsatExcludeKeywords).toEqual(['WordPress'])
    expect(imported.kafKeywordsAny).toEqual(['تصميم'])
    expect(imported.runAtStartup).toBe(false)
    expect(getSettingRaw(destination, 'proposal-profile')).toBe(getSettingRaw(source, 'proposal-profile'))
    expect(getSettingRaw(destination, 'ai-settings')).toBe(getSettingRaw(source, 'ai-settings'))
    expect(JSON.stringify(payload)).not.toContain('DO_NOT_EXPORT')
    expect(importSettings(destination, imported, payload, 'merge', true).runAtStartup).toBe(true)
  })
  it('accepts old exports without overwriting the destination profile/model settings', () => {
    const db = database(); seed(db)
    const before = getSettingRaw(db, 'ai-settings')
    const legacy = parseSettingsTransfer({ format: 'rased-settings', version: 1, settings: { language: 'en' }, savedFilters: [] })
    expect(importSettings(db, defaultSettings(), legacy, 'merge', false).language).toBe('en')
    expect(getSettingRaw(db, 'ai-settings')).toBe(before)
  })
  it.each([{ khamsatEnabled: 'false' }, { nafezlyKeywordsAny: ['ok', 10] }, { quickApply: { enabled: true } }, { ui: [] }, { ui: { theme: 'neon' } }, { displayQuery: { budgetMin: -100 } }])('rejects malformed preferences without applying defaults: %j', settings => {
    expect(() => parseSettingsTransfer({ format: 'rased-settings', version: 2, settings, savedFilters: [] })).toThrow('bad-schema')
  })
  it('strips unknown nested fields instead of exporting accidental credentials', () => {
    const db = database(); seed(db)
    const settings = { ...defaultSettings(), quickApply: { ...defaultSettings().quickApply, apiKey: 'PRIVATE_NESTED_CREDENTIAL' } }
    setSettingRaw(db, 'app', JSON.stringify(settings))
    expect(JSON.stringify(settingsPayload(db))).not.toContain('PRIVATE_NESTED_CREDENTIAL')
    expect(JSON.stringify(parseSettingsTransfer({ format: 'rased-settings', version: 2, settings, savedFilters: [] }))).not.toContain('PRIVATE_NESTED_CREDENTIAL')
  })
  it('rolls back settings/profile changes if any write fails', () => {
    const db = database(); seed(db)
    db.exec("CREATE TRIGGER reject_profile BEFORE UPDATE ON settings WHEN NEW.key='proposal-profile' BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    const before = getSettingRaw(db, 'app'), payload = settingsPayload(db)
    payload.settings.language = 'en'
    expect(() => importSettings(db, defaultSettings(), payload, 'replace', true)).toThrow()
    expect(getSettingRaw(db, 'app')).toBe(before)
  })
})

describe('Complete portable backups', () => {
  it('removes notification activation capabilities from portable bytes and clears destination leases on restore', async () => {
    const folder = profile(), source = database(folder); seed(source)
    const ticket = issueNotificationActivation(source, { url: 'https://mostaql.com/go/44', projectId: 1 })
    const hash = String(source.prepare('SELECT token_hash FROM notification_activations').get()!.token_hash)
    const file = join(folder, 'notifications.rased-backup')
    await createPortableBackup(source, file, '0.8.0')
    expect(readFileSync(file).includes(Buffer.from(hash))).toBe(false)
    const target = database(); seed(target)
    const local = issueNotificationActivation(target, { url: 'https://mostaql.com/go/44', projectId: 1 })
    restoreDatabase(target, file, false, 'restore', 'rollback')
    expect(claimNotificationActivation(target, local)).toBeNull()
    expect(claimNotificationActivation(target, ticket)).toBeNull()
  })
  it('continues to inspect and restore original schema-eight archives', async () => {
    const folder = profile(), source = database(folder); seed(source)
    const file = join(folder, 'old.rased-backup')
    await createPortableBackup(source, file, '0.8.0')
    const old = openDatabase(file); databases.push(old)
    const manifest = JSON.parse(String(old.prepare('SELECT json FROM rased_backup_manifest').get()!.json))
    manifest.schemaVersion = 8
    old.exec('DROP TABLE notification_activations; PRAGMA user_version=8')
    old.prepare('UPDATE rased_backup_manifest SET json=?').run(JSON.stringify(manifest))
    old.close()
    expect(inspectBackup(file).counts.projects).toBe(1)
    const target = database()
    restoreDatabase(target, file, false, 'old-restore', 'rollback')
    expect(getProposalDraft(target, 1)?.proposal).toBe('عرض محفوظ')
  })
  it('includes WAL writes, notes, details and drafts while removing secrets and queued actions from file bytes', async () => {
    const folder = profile(), db = database(folder); seed(db)
    setSettingRaw(db, 'secret-fixture', 'PRIVATE_PAIRING_TOKEN_123456789')
    db.prepare("INSERT INTO extension_jobs(ticket,request_id,project_id,expires_at,updated_at) VALUES('SECRET_TICKET_123456','request',1,9999999999999,1)").run()
    db.prepare("INSERT INTO notification_events(project_id,status,created_at,updated_at) VALUES(1,'dispatching',?,?)").run(now, now)
    const file = join(folder, 'portable.rased-backup')
    const info = await createPortableBackup(db, file, '0.7.0')
    expect(info.counts).toEqual({ projects: 1, notes: 1, drafts: 1, filters: 0 })
    const bytes = readFileSync(file)
    expect(bytes.includes(Buffer.from('PRIVATE_PAIRING_TOKEN_123456789'))).toBe(false)
    expect(bytes.includes(Buffer.from('SECRET_TICKET_123456'))).toBe(false)
    const target = database()
    restoreDatabase(target, file, false, 'test-restore', 'rollback.rased-backup')
    expect(getProposalDraft(target, 1)?.proposal).toBe('عرض محفوظ')
    expect(target.prepare('SELECT note FROM project_user_state').get()).toEqual({ note: 'ملاحظة شخصية' })
    expect(target.prepare('SELECT description_text FROM project_details').get()).toEqual({ description_text: 'تفاصيل كاملة' })
    expect(target.prepare('SELECT status FROM notification_events').get()).toEqual({ status: 'suppressed' })
    expect(JSON.parse(getSettingRaw(target, 'app')!).runAtStartup).toBe(false)
  })
  it('protects the live database and preserves an existing destination after a failed snapshot', async () => {
    const folder = profile(), db = database(folder); seed(db)
    await expect(createPortableBackup(db, join(folder, 'rased.db'), '0.7.0')).rejects.toThrow('protected-location')
    expect(db.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 1 })
    const destination = join(folder, 'existing.rased-backup')
    writeFileSync(destination, 'keep original file')
    db.close()
    await expect(createPortableBackup(db, destination, '0.7.0')).rejects.toThrow()
    expect(readFileSync(destination, 'utf8')).toBe('keep original file')
  })
  it('rejects unsupported schema and non-backup databases', async () => {
    const folder = profile(), db = database(folder); seed(db)
    expect(() => inspectBackup(join(folder, 'rased.db'))).toThrow()
    const file = join(folder, 'portable.rased-backup'); await createPortableBackup(db, file, '0.7.0')
    const malformed = openDatabase(file); databases.push(malformed)
    malformed.exec('PRAGMA user_version=999'); malformed.close()
    expect(() => inspectBackup(file)).toThrow('newer-schema')
  })
  it('restores every durable table atomically and preserves local cooldowns, key metadata and backup preferences', async () => {
    const folder = profile(), source = database(folder); seed(source)
    const def = defaultSettings().displayQuery
    saveSavedFilterRow(source, { id: 'filter', name: 'React', definition: def, createdAt: now, updatedAt: now })
    const file = join(folder, 'portable.rased-backup'); await createPortableBackup(source, file, '0.7.0')
    const target = database(); seed(target)
    setSettingRaw(target, 'data-backup-preferences', '{"schedule":"daily","keep":3}')
    setSettingRaw(target, 'local-only-key-metadata', 'stay-on-device')
    const cooldown = new Date(Date.now() + 3600000).toISOString()
    target.prepare("INSERT INTO source_state(source,backoff_until,consecutive_failures,last_error) VALUES('nafezly',?,4,'http-429')").run(cooldown)
    restoreDatabase(target, file, true, 'restore-id', 'rollback.rased-backup')
    expect(getSettingRaw(target, 'data-backup-preferences')).toBe('{"schedule":"daily","keep":3}')
    expect(getSettingRaw(target, 'local-only-key-metadata')).toBe('stay-on-device')
    expect(target.prepare("SELECT backoff_until FROM source_state WHERE source='nafezly'").get()).toEqual({ backoff_until: cooldown })
    expect(JSON.parse(getSettingRaw(target, 'app')!).runAtStartup).toBe(true)
    target.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON saved_filters BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    target.prepare("UPDATE projects SET title='keep this title'").run()
    await expect(Promise.resolve().then(() => restoreDatabase(target, file, false, 'fail-id', 'unused'))).rejects.toThrow()
    expect(target.prepare('SELECT title FROM projects').get()).toEqual({ title: 'keep this title' })
  })
})
