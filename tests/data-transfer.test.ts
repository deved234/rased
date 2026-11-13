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
import { rebuildSearchBatch } from '../src/storage/searchCache.js'

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
  it('round-trips explicit private search scopes and defaults missing legacy flags off', () => {
    const source = database(); seed(source)
    const settings = defaultSettings(); settings.displayQuery.searchInNotes = true; settings.displayQuery.searchInDrafts = true
    setSettingRaw(source, 'app', JSON.stringify(settings))
    const transfer = parseSettingsTransfer(settingsPayload(source)), target = database()
    importSettings(target, defaultSettings(), transfer, 'replace', false)
    expect(JSON.parse(getSettingRaw(target, 'app')!).displayQuery.searchInNotes).toBe(true)
    expect(JSON.parse(getSettingRaw(target, 'app')!).displayQuery.searchInDrafts).toBe(true)
    const legacy = parseSettingsTransfer({ format: 'rased-settings', version: 2, settings: { displayQuery: { search: 'legacy' } }, savedFilters: [] })
    const imported = importSettings(target, defaultSettings(), legacy, 'replace', false)
    expect(imported.displayQuery.searchInNotes).toBe(false); expect(imported.displayQuery.searchInDrafts).toBe(false)
  })
  it('accounts for every current setting and intentionally excludes only session/device state', () => {
    expect(Object.keys(defaultSettings()).filter(key => !TRANSFER_SETTINGS_KEYS.includes(key as typeof TRANSFER_SETTINGS_KEYS[number])).sort()).toEqual(['compactBounds', 'doNotDisturbUntil', 'whatsNewSeen'])
  })
  it('keeps the local release marker through merge and replace imports', () => {
    const db = database()
    const current = { ...defaultSettings(), whatsNewSeen: '1.2.0' }
    const payload = parseSettingsTransfer({ format: 'rased-settings', version: 2, settings: { language: 'en', whatsNewSeen: '9.9.9' }, savedFilters: [] })
    expect(settingsPayload(db, current).settings).not.toHaveProperty('whatsNewSeen')
    for (const mode of ['merge', 'replace'] as const) {
      expect(importSettings(db, current, payload, mode, false).whatsNewSeen).toBe('1.2.0')
    }
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
  it('accepts genuine schema-nine archives and clears/requeues all derived data on restore', async () => {
    const folder = profile(), source = database(folder); seed(source)
    while (!rebuildSearchBatch(source).complete) { /* populate derived data before exporting */ }
    const file = join(folder, 'schema-nine.rased-backup'); await createPortableBackup(source, file, '0.8.1')
    const old = openDatabase(file); databases.push(old)
    expect(old.prepare('SELECT COUNT(*) AS n FROM project_search_cache').get()!.n).toBe(0)
    expect(old.prepare('SELECT COUNT(*) AS n FROM project_search_fts').get()!.n).toBe(0)
    const manifest = JSON.parse(String(old.prepare('SELECT json FROM rased_backup_manifest').get()!.json))
    manifest.schemaVersion = 9; downgradeToSchema10(old); removeSearchSchema(old); old.exec('PRAGMA user_version=9')
    old.prepare('UPDATE rased_backup_manifest SET json=?').run(JSON.stringify(manifest)); old.close()
    expect(inspectBackup(file).counts.projects).toBe(1)
    const target = database(); seed(target); while (!rebuildSearchBatch(target).complete) { /* old target cache */ }
    restoreDatabase(target, file, false, 'schema-nine', 'rollback')
    expect(target.prepare('SELECT COUNT(*) AS n FROM project_search_cache').get()!.n).toBe(0)
    expect(target.prepare('SELECT COUNT(*) AS n FROM project_search_dirty').get()!.n).toBe(1)
    expect(target.prepare('SELECT note FROM project_user_state').get()!.note).toBe('ملاحظة شخصية')
  })
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
    downgradeToSchema10(old)
    removeSearchSchema(old)
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
    setSettingRaw(target, 'app', JSON.stringify({ ...defaultSettings(), whatsNewSeen: '1.2.0' }))
    const cooldown = new Date(Date.now() + 3600000).toISOString()
    target.prepare("INSERT INTO source_state(source,backoff_until,consecutive_failures,last_error) VALUES('nafezly',?,4,'http-429')").run(cooldown)
    restoreDatabase(target, file, true, 'restore-id', 'rollback.rased-backup')
    expect(getSettingRaw(target, 'data-backup-preferences')).toBe('{"schedule":"daily","keep":3}')
    expect(getSettingRaw(target, 'local-only-key-metadata')).toBe('stay-on-device')
    expect(JSON.parse(getSettingRaw(target, 'app')!).whatsNewSeen).toBe('1.2.0')
    expect(target.prepare("SELECT backoff_until FROM source_state WHERE source='nafezly'").get()).toEqual({ backoff_until: cooldown })
    expect(JSON.parse(getSettingRaw(target, 'app')!).runAtStartup).toBe(true)
    target.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON saved_filters BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    target.prepare("UPDATE projects SET title='keep this title'").run()
    await expect(Promise.resolve().then(() => restoreDatabase(target, file, false, 'fail-id', 'unused'))).rejects.toThrow()
    expect(target.prepare('SELECT title FROM projects').get()).toEqual({ title: 'keep this title' })
  })
  it('round-trips version-11 archives with project_watch while sanitizing local and episode state', async () => {
    const folder = profile(), source = database(folder); seed(source)
    upsertProjectsBatch(source, [
      { source: 'mostaql', externalId: '45', url: 'https://mostaql.com/go/45', title: 'P2', descriptionExcerpt: '', publishedAt: now, publishedRaw: now },
      { source: 'mostaql', externalId: '46', url: 'https://mostaql.com/go/46', title: 'P3', descriptionExcerpt: '', publishedAt: now, publishedRaw: now }
    ], { now, discoveryKind: 'live' })
    source.prepare("INSERT INTO project_watch (project_id, state, origin, last_error, status) VALUES (1, 'active', 'test', 'network-error', 'open')").run()
    source.prepare("INSERT INTO project_watch (project_id, state, origin, waiting_since) VALUES (2, 'waiting', 'test', ?)").run(now)
    source.prepare("INSERT INTO project_watch (project_id, state, origin, stopped_at, stop_reason) VALUES (3, 'stopped', 'test', ?, 'completed')").run(now)

    source.prepare("INSERT INTO watch_source_state (source, slot_ms, success_streak) VALUES ('mostaql', 1500, 3)").run()
    source.prepare("INSERT INTO watch_episode (id, started_at, deadline_at) VALUES (1, ?, ?)").run(now, now)
    source.prepare("INSERT INTO watch_episode_member (episode_id, project_id, generation) VALUES (1, 1, 0)").run()

    source.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, episode_id, created_at, updated_at) VALUES (1, 'watch_status', 'pending', 'k1', 1, ?, ?)").run(now, now)

    const file = join(folder, 'v11.rased-backup')
    const inspected = await createPortableBackup(source, file, '0.11.0')
    expect(inspected.manifest.schemaVersion).toBe(11)

    const archive = openDatabase(file); databases.push(archive)
    expect(archive.prepare("SELECT last_error FROM project_watch WHERE project_id = 1").get()).toEqual({ last_error: null })
    expect(archive.prepare("SELECT COUNT(*) AS n FROM watch_episode").get()).toEqual({ n: 0 })
    expect(archive.prepare("SELECT COUNT(*) AS n FROM watch_episode_member").get()).toEqual({ n: 0 })
    expect(archive.prepare("SELECT COUNT(*) AS n FROM watch_source_state").get()).toEqual({ n: 0 })
    expect(archive.prepare("SELECT episode_id FROM notification_events WHERE dedupe_key = 'k1'").get()).toEqual({ episode_id: null })
    archive.close()

    const target = database()
    restoreDatabase(target, file, false, 'v11-restore', 'rollback')
    expect(target.prepare("SELECT state, origin, last_error, status FROM project_watch WHERE project_id = 1").get()).toEqual({
      state: 'active',
      origin: 'test',
      last_error: null,
      status: 'open'
    })
    expect(target.prepare("SELECT state, origin, waiting_since FROM project_watch WHERE project_id = 2").get()).toEqual({
      state: 'waiting',
      origin: 'test',
      waiting_since: now
    })
    expect(target.prepare("SELECT state, origin, stopped_at, stop_reason FROM project_watch WHERE project_id = 3").get()).toEqual({
      state: 'stopped',
      origin: 'test',
      stopped_at: now,
      stop_reason: 'completed'
    })
    expect(target.prepare("SELECT episode_id FROM notification_events WHERE dedupe_key = 'k1'").get()).toEqual({ episode_id: null })
  })
  it('rejects version-11 archives with non-canonical project_watch timestamps and accepts canonical ones', async () => {
    const folder = profile(), source = database(folder); seed(source)
    source.prepare("INSERT INTO project_watch (project_id, state, origin, started_at) VALUES (1, 'active', 'test', '2026-10-01T11:00:00.000Z')").run()
    const file = join(folder, 'canonical-watch.rased-backup')
    const inspected = await createPortableBackup(source, file, '0.11.0')
    expect(inspected.manifest.schemaVersion).toBe(11)

    // Canonical archive inspects successfully
    expect(inspectBackup(file).manifest.schemaVersion).toBe(11)

    // Tamper with archive to insert non-canonical started_at: '2026-10-01T11:00:00-02:00'
    const archive = openDatabase(file); databases.push(archive)
    archive.prepare("UPDATE project_watch SET started_at = '2026-10-01T11:00:00-02:00' WHERE project_id = 1").run()
    archive.close()

    // Non-canonical timestamp must be rejected with 'bad-schema'
    expect(() => inspectBackup(file)).toThrow('bad-schema')
  })
  it('leaves destination watch_source_state untouched and clears previous destination watch rows on restore', async () => {
    const folder = profile(), source = database(folder); seed(source)
    const file = join(folder, 'untouched.rased-backup')
    await createPortableBackup(source, file, '0.11.0')

    const target = database(); seed(target)
    target.prepare("INSERT INTO watch_source_state (source, slot_ms, success_streak) VALUES ('nafezly', 2500, 7)").run()
    target.prepare("INSERT INTO project_watch (project_id, state, origin) VALUES (1, 'active', 'old')").run()
    target.prepare("INSERT INTO watch_episode (id, started_at, deadline_at) VALUES (99, ?, ?)").run(now, now)
    target.prepare("INSERT INTO watch_episode_member (episode_id, project_id, generation) VALUES (99, 1, 0)").run()

    restoreDatabase(target, file, false, 'untouched-restore', 'rollback')
    expect(target.prepare("SELECT source, slot_ms, success_streak FROM watch_source_state WHERE source = 'nafezly'").get()).toEqual({
      source: 'nafezly',
      slot_ms: 2500,
      success_streak: 7
    })
    expect(target.prepare("SELECT COUNT(*) AS n FROM watch_episode").get()).toEqual({ n: 0 })
    expect(target.prepare("SELECT COUNT(*) AS n FROM watch_episode_member").get()).toEqual({ n: 0 })
    expect(target.prepare("SELECT COUNT(*) AS n FROM project_watch").get()).toEqual({ n: 0 })
  })
  it('restores over a populated destination that already has projects, project_watch, and events', async () => {
    const folder = profile(), source = database(folder)
    upsertProjectsBatch(source, [{ source: 'mostaql', externalId: 'src-1', url: 'https://mostaql.com/go/src-1', title: 'Source P1', descriptionExcerpt: '', publishedAt: now, publishedRaw: now }], { now, discoveryKind: 'live' })
    source.prepare("INSERT INTO project_watch (project_id, state, origin) VALUES (1, 'active', 'from-source')").run()
    source.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'pending', 'k-src', ?, ?)").run(now, now)
    const file = join(folder, 'populated.rased-backup')
    await createPortableBackup(source, file, '0.11.0')

    const target = database()
    upsertProjectsBatch(target, [{ source: 'nafezly', externalId: 'dst-1', url: 'https://nafezly.com/go/dst-1', title: 'Dest P1', descriptionExcerpt: '', publishedAt: now, publishedRaw: now }], { now, discoveryKind: 'live' })
    target.prepare("INSERT INTO project_watch (project_id, state, origin) VALUES (1, 'waiting', 'from-dest')").run()
    target.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at) VALUES (1, 'new_project', 'pending', '', ?, ?)").run(now, now)

    restoreDatabase(target, file, false, 'overwrite-restore', 'rollback')
    expect(target.prepare("SELECT title FROM projects").all()).toEqual([{ title: 'Source P1' }])
    expect(target.prepare("SELECT state, origin FROM project_watch").all()).toEqual([{ state: 'active', origin: 'from-source' }])
  })
  it('accepts and restores version 10, 9, and 8 archives with legacy semantics', async () => {
    for (const ver of [10, 9, 8] as const) {
      const folder = profile(), source = database(folder); seed(source)
      source.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at) VALUES (1, 'new_project', 'pending', '', ?, ?)").run(now, now)
      const file = join(folder, `v${ver}.rased-backup`)
      await createPortableBackup(source, file, '0.8.0')

      const old = openDatabase(file); databases.push(old)
      const manifest = JSON.parse(String(old.prepare('SELECT json FROM rased_backup_manifest').get()!.json)) as { schemaVersion: number }
      manifest.schemaVersion = ver
      downgradeToSchema10(old)
      if (ver < 10) removeSearchSchema(old)
      if (ver === 8) old.exec('DROP TABLE notification_activations;')
      old.exec(`PRAGMA user_version = ${ver};`)
      old.prepare('UPDATE rased_backup_manifest SET json=?').run(JSON.stringify(manifest))
      old.close()

      expect(inspectBackup(file).manifest.schemaVersion).toBe(ver)

      const target = database(); seed(target)
      target.prepare("INSERT INTO project_watch (project_id, state, origin) VALUES (1, 'active', 'local')").run()
      restoreDatabase(target, file, false, `v${ver}-restore`, 'rollback')

      expect(target.prepare("SELECT status, dedupe_key, payload, episode_id FROM notification_events WHERE project_id = 1").get()).toEqual({
        status: 'suppressed',
        dedupe_key: '',
        payload: null,
        episode_id: null
      })
      expect(target.prepare("SELECT COUNT(*) AS n FROM project_watch").get()).toEqual({ n: 0 })
    }
  })
  it('rejects archives violating schema compatibility rules with bad-schema', async () => {
    const folder = profile(), source = database(folder); seed(source)

    // 1. Version-10 archive that contains project_watch table
    const f1 = join(folder, 'bad1.rased-backup')
    await createPortableBackup(source, f1, '0.10.0')
    let dbBad = openDatabase(f1); databases.push(dbBad)
    let m = JSON.parse(String(dbBad.prepare('SELECT json FROM rased_backup_manifest').get()!.json)) as { schemaVersion: number }
    m.schemaVersion = 10
    dbBad.exec('DROP TABLE IF EXISTS watch_episode_member; DROP TABLE IF EXISTS watch_episode; DROP TABLE IF EXISTS watch_source_state;')
    dbBad.exec('PRAGMA user_version = 10;')
    dbBad.prepare('UPDATE rased_backup_manifest SET json=?').run(JSON.stringify(m))
    dbBad.close()
    expect(() => inspectBackup(f1)).toThrow('bad-schema')

    // 2. Version-10 archive whose notification_events has the NEW definition
    const f2 = join(folder, 'bad2.rased-backup')
    await createPortableBackup(source, f2, '0.10.0')
    dbBad = openDatabase(f2); databases.push(dbBad)
    m = JSON.parse(String(dbBad.prepare('SELECT json FROM rased_backup_manifest').get()!.json)) as { schemaVersion: number }
    m.schemaVersion = 10
    dbBad.exec('DROP TABLE IF EXISTS watch_episode_member; DROP TABLE IF EXISTS watch_episode; DROP TABLE IF EXISTS watch_source_state; DROP TABLE IF EXISTS project_watch;')
    dbBad.exec('PRAGMA user_version = 10;')
    dbBad.prepare('UPDATE rased_backup_manifest SET json=?').run(JSON.stringify(m))
    dbBad.close()
    expect(() => inspectBackup(f2)).toThrow('bad-schema')

    // 3. Version-11 archive whose notification_events has the LEGACY definition
    const f3 = join(folder, 'bad3.rased-backup')
    await createPortableBackup(source, f3, '0.11.0')
    dbBad = openDatabase(f3); databases.push(dbBad)
    dbBad.exec(`
      CREATE TABLE notification_events_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'new_project',
        status TEXT NOT NULL DEFAULT 'pending',
        session_id TEXT NULL,
        attempted_at TEXT NULL,
        batch_key TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, kind)
      );
      INSERT INTO notification_events_legacy SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events;
      DROP TABLE notification_events;
      CREATE TABLE IF NOT EXISTS notification_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'new_project',
        status TEXT NOT NULL DEFAULT 'pending',
        session_id TEXT NULL,
        attempted_at TEXT NULL,
        batch_key TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, kind)
      );
      INSERT INTO notification_events SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events_legacy;
      DROP TABLE notification_events_legacy;
      CREATE INDEX IF NOT EXISTS idx_notify_status ON notification_events(status);
    `)
    dbBad.close()
    expect(() => inspectBackup(f3)).toThrow('bad-schema')

    // 4. Version-11 archive with a row in watch_source_state
    const f4 = join(folder, 'bad4.rased-backup')
    await createPortableBackup(source, f4, '0.11.0')
    dbBad = openDatabase(f4); databases.push(dbBad)
    dbBad.prepare("INSERT INTO watch_source_state (source, slot_ms) VALUES ('mostaql', 1000)").run()
    dbBad.close()
    expect(() => inspectBackup(f4)).toThrow('bad-schema')

    // 5. Version-11 archive with a row in watch_episode
    const f5 = join(folder, 'bad5.rased-backup')
    await createPortableBackup(source, f5, '0.11.0')
    dbBad = openDatabase(f5); databases.push(dbBad)
    dbBad.prepare("INSERT INTO watch_episode (id, started_at, deadline_at) VALUES (1, 't', 't')").run()
    dbBad.close()
    expect(() => inspectBackup(f5)).toThrow('bad-schema')

    // 6. Version-11 archive with a row in watch_episode_member
    const f6 = join(folder, 'bad6.rased-backup')
    await createPortableBackup(source, f6, '0.11.0')
    dbBad = openDatabase(f6); databases.push(dbBad)
    dbBad.prepare("INSERT INTO watch_episode (id, started_at, deadline_at) VALUES (1, 't', 't')").run()
    dbBad.prepare("INSERT INTO watch_episode_member (episode_id, project_id, generation) VALUES (1, 1, 0)").run()
    dbBad.close()
    expect(() => inspectBackup(f6)).toThrow('bad-schema')

    // 7. Version-11 archive missing project_watch
    const f7 = join(folder, 'bad7.rased-backup')
    await createPortableBackup(source, f7, '0.11.0')
    dbBad = openDatabase(f7); databases.push(dbBad)
    dbBad.exec('DROP TABLE project_watch;')
    dbBad.close()
    expect(() => inspectBackup(f7)).toThrow('bad-schema')

    // 8. Version-11 archive with non-canonical project_watch timestamp
    const f8 = join(folder, 'bad8.rased-backup')
    await createPortableBackup(source, f8, '0.11.0')
    dbBad = openDatabase(f8); databases.push(dbBad)
    dbBad.prepare("INSERT INTO project_watch (project_id, state, origin, started_at) VALUES (1, 'active', 'list', '2026-10-01T11:00:00-02:00')").run()
    dbBad.close()
    expect(() => inspectBackup(f8)).toThrow('bad-schema')

    // 9. Version-11 archive with canonical project_watch timestamp is accepted
    const f9 = join(folder, 'good9.rased-backup')
    await createPortableBackup(source, f9, '0.11.0')
    const dbGood = openDatabase(f9); databases.push(dbGood)
    dbGood.prepare("INSERT INTO project_watch (project_id, state, origin, started_at) VALUES (1, 'active', 'list', '2026-10-01T13:00:00.000Z')").run()
    dbGood.close()
    expect(inspectBackup(f9).manifest.schemaVersion).toBe(11)
  })
})
import { downgradeToSchema10, removeSearchSchema } from './helpers/oldSchema.js'

describe('device-local standing consent portability', () => {
  const consent = JSON.stringify({ version: 1, provider: 'openai', model: 'example-model', keyRevision: 'local-revision', grantedAt: '2026-10-23T00:00:00.000Z' })
  it('omits consent from exports and clears an existing grant on v1/v2 import', () => {
    const db = database(); seed(db)
    for (const version of [1, 2] as const) {
      setSettingRaw(db, 'ai-quick-consent', consent)
      const payload = settingsPayload(db)
      expect(JSON.stringify(payload)).not.toContain('local-revision')
      importSettings(db, defaultSettings(), parseSettingsTransfer({ ...payload, version }), 'merge', false)
      expect(getSettingRaw(db, 'ai-quick-consent')).toBeNull()
    }
    expect(() => parseSettingsTransfer({ ...settingsPayload(db), 'ai-quick-consent': JSON.parse(consent) })).toThrow('bad-schema')
  })
  it('exports a portable archive, clears destination consent transactionally and rejects injected grants', async () => {
    const folder = profile(), source = database(folder); seed(source)
    setSettingRaw(source, 'ai-quick-consent', consent)
    const file = join(folder, 'standing.rased-backup')
    await createPortableBackup(source, file, '0.10.0')
    const backup = openDatabase(file); databases.push(backup)
    expect(getSettingRaw(backup, 'ai-quick-consent')).toBeNull()
    backup.close()
    expect(inspectBackup(file).manifest.appVersion).toBe('0.10.0')
    const target = database(); seed(target)
    setSettingRaw(target, 'ai-quick-consent', consent)
    target.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    expect(() => restoreDatabase(target, file, false, 'failed', 'rollback')).toThrow()
    expect(getSettingRaw(target, 'ai-quick-consent')).toBe(consent)
    target.exec('DROP TRIGGER reject_restore')
    restoreDatabase(target, file, false, 'success', 'rollback')
    expect(getSettingRaw(target, 'ai-quick-consent')).toBeNull()
    const injected = openDatabase(file); databases.push(injected)
    setSettingRaw(injected, 'ai-quick-consent', consent); injected.close()
    expect(() => inspectBackup(file)).toThrow('bad-schema')
  })
})
