import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type Db } from '../src/storage/db.js'
import { getSettingRaw, runInTransaction, saveSavedFilterRow, setSettingRaw, upsertProjectsBatch } from '../src/storage/repositories.js'
import { defaultSettings, type AppSettings } from '../src/shared/types.js'
import { emptyProposalProfile } from '../src/shared/proposals.js'
import { defaultProfile, LEGACY_PROFILE_ID, sanitizeProfileSet, type ProfileSet } from '../src/shared/proposalProfiles.js'
import { readProfileSet, writeProfileSetTx } from '../src/storage/proposalProfiles.js'
import { getProposalProfile, saveProfileSet, saveProposalProfile } from '../src/main/proposals.js'
import { mergeSettings } from '../src/main/policies.js'
import { importSettings, parseSettingsTransfer, settingsPayload } from '../src/storage/settingsTransfer.js'
import { createPortableBackup, inspectBackup, restoreDatabase } from '../src/storage/backups.js'
import { AiService } from '../src/main/ai/service.js'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '') } }))

const otherId = 'a'.repeat(32)
const fixture = (): ProfileSet => ({ version: 1, defaultId: LEGACY_PROFILE_ID, profiles: [
  { ...emptyProposalProfile(), id: LEGACY_PROFILE_ID, name: 'Default', skills: 'React', quickTemplate: 'Default template' },
  { ...emptyProposalProfile(), id: otherId, name: 'Other', skills: 'Design', quickTemplate: 'Other template' }
] })
let db: Db, folder: string
const app = (): AppSettings => JSON.parse(getSettingRaw(db, 'app')!)
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'rased-profile-set-'))
  db = openDatabase(join(folder, 'rased.db'))
  setSettingRaw(db, 'app', JSON.stringify({ ...defaultSettings(), whatsNewSeen: '0.10.0' }))
})
afterEach(() => { db.close(); rmSync(folder, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('profile set storage', () => {
  it('sanitizes bounds, rejects duplicate/invalid IDs and missing defaults', () => {
    expect(sanitizeProfileSet(fixture())).toEqual(fixture())
    for (const mutate of [
      (s: ProfileSet) => { s.profiles = [] },
      (s: ProfileSet) => { s.profiles.push(s.profiles[0]!) },
      (s: ProfileSet) => { s.profiles[0]!.id = 'bad' },
      (s: ProfileSet) => { s.defaultId = 'b'.repeat(32) },
      (s: ProfileSet) => { s.profiles[0]!.name = ' ' },
      (s: ProfileSet) => { s.profiles[0]!.name = 'x'.repeat(61) },
      (s: ProfileSet) => { s.profiles[0]!.quickTemplate = 'x'.repeat(10001) },
      (s: ProfileSet) => { s.profiles[0]!.skills = 'x'.repeat(2001) },
      (s: ProfileSet) => { s.profiles = Array.from({ length: 11 }, (_, i) => ({ ...s.profiles[0]!, id: i.toString(16).padStart(32, '0') })) }
    ]) { const set = fixture(); mutate(set); expect(sanitizeProfileSet(set)).toBeNull() }
    const set = fixture(); set.profiles[0]!.name = '  Name  '; set.profiles[0]!.quickTemplate = ''
    expect(defaultProfile(sanitizeProfileSet(set)!).name).toBe('Name')
    expect(sanitizeProfileSet({ ...set, version: 2 })).toBeNull()
  })
  it('migrates only in memory using a stable ID and copies both legacy facts and template', () => {
    setSettingRaw(db, 'proposal-profile', JSON.stringify({ ...emptyProposalProfile(), skills: 'Legacy' }))
    const settings = app(); settings.quickApply.template = 'Legacy template'; setSettingRaw(db, 'app', JSON.stringify(settings))
    const first = readProfileSet(db)
    expect(first.error).toBeNull()
    expect(defaultProfile(first.set)).toMatchObject({ id: LEGACY_PROFILE_ID, skills: 'Legacy', quickTemplate: 'Legacy template' })
    expect(readProfileSet(db)).toEqual(first)
    expect(getSettingRaw(db, 'proposal-profiles')).toBeNull()
  })
  it('commits both mirrors before publishing live settings and keeps unrelated app state', () => {
    const observer = openDatabase(join(folder, 'rased.db'))
    const publish = vi.fn((settings: AppSettings) => {
      expect(getSettingRaw(observer, 'proposal-profiles')).toBe(JSON.stringify(fixture()))
      expect(JSON.parse(getSettingRaw(db, 'proposal-profile')!).skills).toBe('React')
      expect(app().quickApply.template).toBe('Default template')
      expect(settings).toEqual(app())
    })
    try { saveProfileSet(db, fixture(), publish) } finally { observer.close() }
    expect(publish).toHaveBeenCalledTimes(1)
    expect(app().whatsNewSeen).toBe('0.10.0')
    expect(saveProposalProfile(db, { ...emptyProposalProfile(), skills: 'Updated' })).not.toBeNull()
    expect(defaultProfile(readProfileSet(db).set).skills).toBe('Updated')
    expect(readProfileSet(db).set.profiles[1]!.skills).toBe('Design')
  })
  it('does not publish after rollback and writeProfileSetTx participates in the caller transaction', () => {
    saveProfileSet(db, fixture())
    const before = getSettingRaw(db, 'proposal-profiles'), beforeApp = getSettingRaw(db, 'app'), beforeMirror = getSettingRaw(db, 'proposal-profile')
    const next = fixture(); next.defaultId = otherId
    expect(() => runInTransaction(db, () => { writeProfileSetTx(db, next); throw Error('rollback') })).toThrow('rollback')
    expect(getSettingRaw(db, 'proposal-profiles')).toBe(before)
    expect(getSettingRaw(db, 'app')).toBe(beforeApp)
    expect(getSettingRaw(db, 'proposal-profile')).toBe(beforeMirror)
    db.exec("CREATE TRIGGER reject_profile BEFORE UPDATE ON settings WHEN NEW.key='app' BEGIN SELECT RAISE(ABORT,'fixture'); END")
    const publish = vi.fn()
    expect(() => saveProfileSet(db, next, publish)).toThrow()
    expect(publish).not.toHaveBeenCalled()
    expect(getSettingRaw(db, 'proposal-profiles')).toBe(before)
    expect(getSettingRaw(db, 'proposal-profile')).toBe(beforeMirror)
  })
  it('requires assigning another default before deletion and never deletes the last profile', () => {
    saveProfileSet(db, fixture())
    expect(saveProfileSet(db, { ...fixture(), defaultId: otherId, profiles: [fixture().profiles[1]!] })).toBeNull()
    expect(saveProfileSet(db, { ...fixture(), defaultId: otherId })).not.toBeNull()
    expect(saveProfileSet(db, { ...fixture(), defaultId: otherId, profiles: [fixture().profiles[1]!] })).not.toBeNull()
    expect(saveProfileSet(db, { ...fixture(), profiles: [] })).toBeNull()
  })
  it('ignores updateSettings template text while allowing enabled empty-template preferences', () => {
    const settings = defaultSettings(); settings.quickApply.enabled = true
    const updated = mergeSettings(settings, { quickApply: { enabled: true, template: 'not a writer', budgetPositionPercent: 75, extraDays: 3 } })
    expect(updated.quickApply).toEqual({ enabled: true, template: '', budgetPositionPercent: 75, extraDays: 3 })
  })
  it('reconciles downgrade edits to either mirror without changing other profiles or writing on read', () => {
    saveProfileSet(db, fixture())
    const stored = getSettingRaw(db, 'proposal-profiles')
    setSettingRaw(db, 'proposal-profile', JSON.stringify({ ...emptyProposalProfile(), experience: 'Edited in 0.10.0' }))
    const settings = app(); settings.quickApply.template = 'Old app edit'; setSettingRaw(db, 'app', JSON.stringify(settings))
    const set = readProfileSet(db).set
    expect(defaultProfile(set)).toMatchObject({ experience: 'Edited in 0.10.0', quickTemplate: 'Old app edit' })
    expect(set.profiles[1]).toEqual(fixture().profiles[1])
    expect(getSettingRaw(db, 'proposal-profiles')).toBe(stored)
    saveProfileSet(db, set)
    expect(getProposalProfile(db).experience).toBe('Edited in 0.10.0')
    // The old validQuickApply rejected enabled + empty and sanitized all preferences to defaults.
    const oldApp = app(); oldApp.quickApply = { enabled: false, template: '', budgetPositionPercent: 0, extraDays: 0 }
    setSettingRaw(db, 'app', JSON.stringify(oldApp))
    expect(defaultProfile(readProfileSet(db).set).quickTemplate).toBe('')
    expect(app().quickApply).toEqual({ enabled: false, template: '', budgetPositionPercent: 0, extraDays: 0 })
    expect(readProfileSet(db).set.profiles[1]).toEqual(fixture().profiles[1])
  })
  it.each(['{broken', '{"version":2}', 'null'])('preserves malformed raw %s until explicit recovery', raw => {
    setSettingRaw(db, 'proposal-profiles', raw)
    expect(readProfileSet(db).error).toBe('invalid-profile-set')
    expect(getProposalProfile(db)).toEqual(emptyProposalProfile())
    expect(saveProposalProfile(db, emptyProposalProfile())).toBeNull()
    expect(saveProfileSet(db, fixture())).toBeNull()
    importSettings(db, app(), parseSettingsTransfer({ format: 'rased-settings', version: 3, settings: { language: 'en' }, savedFilters: [] }), 'merge', false)
    expect(getSettingRaw(db, 'proposal-profiles')).toBe(raw)
    expect(() => settingsPayload(db)).toThrow('invalid-profile-set')
    expect(saveProfileSet(db, null, () => {}, true)).not.toBeNull()
    expect(readProfileSet(db).error).toBeNull()
  })
})

describe('profile set portability', () => {
  it.each([1, 2, 3])('imports v%s legacy fields into only the existing default and distinguishes omissions from empty', version => {
    saveProfileSet(db, fixture())
    const base = { format: 'rased-settings', version, savedFilters: [] }
    importSettings(db, app(), parseSettingsTransfer({ ...base, settings: { quickApply: { enabled: true, budgetPositionPercent: 75, extraDays: 4 } } }), 'merge', false)
    expect(defaultProfile(readProfileSet(db).set).quickTemplate).toBe('Default template')
    importSettings(db, app(), parseSettingsTransfer({ ...base, proposalProfile: emptyProposalProfile(), settings: { quickApply: { enabled: true, template: '', budgetPositionPercent: 50, extraDays: 2 } } }), 'merge', false)
    expect(defaultProfile(readProfileSet(db).set)).toMatchObject({ skills: '', quickTemplate: '' })
    expect(readProfileSet(db).set.profiles[1]).toEqual(fixture().profiles[1])
    expect(app().quickApply.enabled).toBe(true)
  })
  it('v3 replaces the set, ignores only conflicting legacy facts/template and imports AI/settings normally', () => {
    saveProfileSet(db, fixture())
    const set = fixture(); set.defaultId = otherId
    const payload = parseSettingsTransfer({ ...settingsPayload(db), proposalProfiles: set, proposalProfile: null, settings: { quickApply: { enabled: true, template: { invalid: true }, budgetPositionPercent: 80, extraDays: 9 } } })
    importSettings(db, app(), payload, 'replace', false)
    expect(readProfileSet(db).set).toEqual(set)
    expect(app().quickApply).toEqual({ enabled: true, template: 'Other template', budgetPositionPercent: 80, extraDays: 9 })
    expect(JSON.parse(getSettingRaw(db, 'proposal-profile')!).skills).toBe('Design')
    const exported = settingsPayload(db)
    expect(exported.version).toBe(3)
    expect(exported.proposalProfiles).toEqual(set)
    expect(exported.proposalProfile?.skills).toBe('Design')
    expect(exported.settings).not.toHaveProperty('whatsNewSeen')
  })
  it.each([null, {}, { version: 2 }, { ...fixture(), profiles: [] }])('rejects invalid v3 sets without writing anything', proposalProfiles => {
    saveProfileSet(db, fixture())
    const before = getSettingRaw(db, 'proposal-profiles')
    expect(() => parseSettingsTransfer({ ...settingsPayload(db), proposalProfiles })).toThrow('bad-schema')
    expect(getSettingRaw(db, 'proposal-profiles')).toBe(before)
  })
  it.each([2, 3])('applies strict settings and AI validation to v%s', version => {
    for (const invalid of [{ settings: { ui: { compactAlwaysOnTop: 'yes' } } }, { aiSettings: null }, { settings: { quickApply: { enabled: 'yes', template: '', budgetPositionPercent: 0, extraDays: 0 } } }]) {
      expect(() => parseSettingsTransfer({ ...settingsPayload(db), version, ...invalid })).toThrow('bad-schema')
    }
  })
  it('rolls back import set, both mirrors, consent, filters and AI settings together', () => {
    saveProfileSet(db, fixture()); setSettingRaw(db, 'ai-quick-consent', 'original-consent')
    setSettingRaw(db, 'ai-settings', JSON.stringify({ schemaVersion: 1, activeProvider: 'gemini', modelByProvider: { gemini: 'gemini-2.5-flash', openai: '', anthropic: '' } }))
    saveSavedFilterRow(db, { id: 'existing', name: 'Existing filter', definition: defaultSettings().displayQuery, createdAt: '2026-10-23', updatedAt: '2026-10-23' })
    const before = db.prepare('SELECT * FROM settings ORDER BY key').all()
    const filters = db.prepare('SELECT * FROM saved_filters').all()
    const payload = settingsPayload(db); payload.proposalProfiles!.defaultId = otherId
    payload.savedFilters = []
    payload.aiSettings!.activeProvider = 'openai'
    db.exec("CREATE TRIGGER reject_ai BEFORE INSERT ON settings WHEN NEW.key='ai-settings' BEGIN SELECT RAISE(ABORT,'fixture'); END")
    expect(() => importSettings(db, app(), payload, 'replace', false)).toThrow()
    expect(db.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
    expect(db.prepare('SELECT * FROM saved_filters').all()).toEqual(filters)
  })
  it('backs up sanitized sets and consistent mirrors, normalizes conflicts and clears destination leftovers for legacy archives', async () => {
    saveProfileSet(db, fixture())
    const raw = fixture()
    raw.profiles[0]!.name = '  Default  '
    setSettingRaw(db, 'proposal-profiles', JSON.stringify({ ...raw, unknownPrivateField: 'must not export' }))
    const modern = join(folder, 'modern.rased-backup')
    await createPortableBackup(db, modern, '0.10.0')
    const archive = openDatabase(modern)
    expect(sanitizeProfileSet(JSON.parse(getSettingRaw(archive, 'proposal-profiles')!))).toEqual(fixture())
    expect(getSettingRaw(archive, 'proposal-profiles')).not.toContain('must not export')
    expect(JSON.parse(getSettingRaw(archive, 'proposal-profile')!).skills).toBe('React')
    const archivedApp = JSON.parse(getSettingRaw(archive, 'app')!); archivedApp.quickApply.template = 'Conflicting mirror'
    setSettingRaw(archive, 'app', JSON.stringify(archivedApp))
    setSettingRaw(archive, 'proposal-profile', JSON.stringify({ ...emptyProposalProfile(), skills: 'Conflict' }))
    archive.close()
    expect(inspectBackup(modern).manifest.appVersion).toBe('0.10.0')
    restoreDatabase(db, modern, false, 'modern', 'rollback')
    expect(readProfileSet(db).set).toEqual(fixture())
    expect(app().quickApply.template).toBe('Default template')
    const old = join(folder, 'legacy.rased-backup')
    await createPortableBackup(db, old, '0.10.0')
    const legacy = openDatabase(old); legacy.prepare("DELETE FROM settings WHERE key='proposal-profiles'").run(); legacy.close()
    restoreDatabase(db, old, false, 'legacy', 'rollback')
    expect(getSettingRaw(db, 'proposal-profiles')).toBeNull()
    expect(readProfileSet(db).set.profiles).toHaveLength(1)
  })
  it.each([
    { label: 'null', template: null },
    { label: 'number', template: 123 },
    { label: 'oversized', template: 'x'.repeat(10001) }
  ])('preserves restored price and days with a malformed $label template mirror', async ({ template }) => {
    const set = fixture(); set.defaultId = otherId
    saveProfileSet(db, set)
    const file = join(folder, 'malformed-mirror.rased-backup')
    await createPortableBackup(db, file, '0.10.0')
    const archive = openDatabase(file)
    try {
      const archived = JSON.parse(getSettingRaw(archive, 'app')!)
      archived.quickApply = { enabled: true, template, budgetPositionPercent: 75, extraDays: 9 }
      setSettingRaw(archive, 'app', JSON.stringify(archived))
    } finally { archive.close() }
    expect(inspectBackup(file).manifest.appVersion).toBe('0.10.0')
    restoreDatabase(db, file, false, 'malformed-mirror', 'rollback')
    expect(app().quickApply).toEqual({ enabled: false, template: 'Other template', budgetPositionPercent: 75, extraDays: 9 })
    expect(readProfileSet(db).set).toEqual(set)
  })
  it('rolls back restore after the set and mirrors have been written', async () => {
    saveProfileSet(db, fixture())
    const file = join(folder, 'restore.rased-backup'); await createPortableBackup(db, file, '0.10.0')
    saveProfileSet(db, { ...fixture(), defaultId: otherId }); setSettingRaw(db, 'ai-quick-consent', 'keep')
    const before = db.prepare('SELECT * FROM settings ORDER BY key').all()
    db.exec("CREATE TRIGGER reject_restore_end BEFORE INSERT ON settings WHEN NEW.key='data-last-restore-id' BEGIN SELECT RAISE(ABORT,'fixture'); END")
    expect(() => restoreDatabase(db, file, false, 'failure', 'rollback')).toThrow()
    expect(db.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
  })
})

describe('selected profile AI boundary', () => {
  it('binds identical facts to distinct IDs, rejects deleted IDs and stale fingerprints, excludes metadata from the prompt', async () => {
    upsertProjectsBatch(db, [{ source: 'mostaql', externalId: '1', url: 'https://mostaql.com/project/1', title: 'Project', descriptionExcerpt: 'Brief', publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'live' })
    const set = fixture(); set.profiles[1] = { ...set.profiles[0]!, id: otherId, name: 'Private name', quickTemplate: 'Private template' }
    saveProfileSet(db, set)
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body)
      expect(body).not.toContain('Private name'); expect(body).not.toContain('Private template'); expect(body).not.toContain(otherId)
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"proposal":"Generated proposal","assumptions":[],"questions":[]}' }] }] }), { status: 200 })
    })
    const ai = new AiService(db, folder, transport as typeof fetch)
    const selection = { provider: 'openai', model: 'gpt-example' } as const
    ai.saveKey('openai', 'fake-unit-key-123456')
    ai.saveSettings({ schemaVersion: 1, activeProvider: 'openai', modelByProvider: { gemini: '', openai: selection.model, anthropic: '' } })
    const first = ai.preview(1, '', selection, LEGACY_PROFILE_ID)!, second = ai.preview(1, '', selection, otherId)!
    expect(first.profile).toEqual(second.profile)
    expect(first.fingerprint).not.toBe(second.fingerprint)
    expect(await ai.generate(1, '', first.fingerprint, selection, otherId)).toMatchObject({ error: 'preview-changed' })
    expect((await ai.generate(1, '', second.fingerprint, selection, otherId)).ok).toBe(true)
    saveProfileSet(db, { ...set, profiles: [set.profiles[0]!] })
    expect(await ai.generate(1, '', second.fingerprint, selection, otherId)).toMatchObject({ error: 'bad-request' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('standing generation follows a changed default without revoking consent or sending its template', async () => {
    upsertProjectsBatch(db, [{ source: 'mostaql', externalId: '1', url: 'https://mostaql.com/project/1', title: 'Project', descriptionExcerpt: 'Brief', publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'live' })
    saveProfileSet(db, fixture())
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(String(init?.body)).toContain('Design'); expect(String(init?.body)).not.toContain('template')
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"proposal":"Generated proposal","assumptions":[],"questions":[]}' }] }] }), { status: 200 })
    })
    const ai = new AiService(db, folder, transport as typeof fetch)
    const selection = { provider: 'openai', model: 'gpt-example' } as const
    ai.saveKey('openai', 'fake-unit-key-123456')
    ai.saveSettings({ schemaVersion: 1, activeProvider: 'openai', modelByProvider: { gemini: '', openai: selection.model, anthropic: '' } })
    expect(ai.setStandingConsent(true, selection)).toBe(true)
    const set = fixture(); set.defaultId = otherId; set.profiles[1]!.quickTemplate = ''
    saveProfileSet(db, set)
    expect(ai.standingAllowed()).toBe(true)
    expect((await ai.generateStanding(1, 'operation')).ok).toBe(true)
  })
})
