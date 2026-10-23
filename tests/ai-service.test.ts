import { QuickAssistant } from '../src/main/extension/quickAssistant.js'
import type { ExtensionBroker } from '../src/main/extension/broker.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, type Db } from '../src/storage/db.js'
import { getSettingRaw, setSettingRaw, upsertProjectDetails, upsertProjectsBatch } from '../src/storage/repositories.js'
import { getProposalDraft, saveProposalDraft } from '../src/storage/proposalDrafts.js'
import { AiService } from '../src/main/ai/service.js'
import { aiKeyPath, deleteAiKey, keyStatus, migrateGeminiKey, readAiKey, saveAiKey } from '../src/main/ai/keyStore.js'
import { getAiSettings, getCapabilities, saveAiSettings } from '../src/main/ai/settings.js'
import { defaultAiSettings, type AiSelection } from '../src/shared/ai.js'
import { LEGACY_PROFILE_ID } from '../src/shared/proposalProfiles.js'

const encryption = vi.hoisted(() => ({ available: true, fail: false }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => encryption.available,
  encryptString: (s: string) => { if (encryption.fail) throw Error('encryption failed'); return Buffer.from('encrypted:' + s) },
  decryptString: (b: Buffer) => { if (!b.toString().startsWith('encrypted:')) throw Error('bad ciphertext'); return b.toString().slice(10) }
} }))
let dir: string, db: Db, id: number
beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'rased-ai-test-'))
  db = openDatabase(join(dir, 'rased.db'))
  id = upsertProjectsBatch(db, [{ source: 'mostaql', externalId: 'ai-test', url: 'https://mostaql.com/go/123', title: 'Private real project', descriptionExcerpt: 'Real project description', publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'live' }).insertedIds[0]!
  encryption.available = true; encryption.fail = false
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
const selection: AiSelection = { provider: 'openai', model: 'gpt-4.1-mini' }
const reply = (): Response => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ proposal: 'A valid proposal', assumptions: [], questions: [] }) }] }] }))
const addProject = (source: string, externalId: string, excerpt: string): number =>
  upsertProjectsBatch(db, [{ source, externalId, url: `https://example.test/${source}/${externalId}`, title: `${source} project`, descriptionExcerpt: excerpt, publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'live' }).insertedIds[0]!
describe('encrypted provider keys and migrations', () => {
  it('keeps separate keys, hides plaintext, changes revision on rotation and deletes only one provider', () => {
    expect(saveAiKey(dir, 'openai', 'fake-openai-key-123456')).toBe(true)
    expect(saveAiKey(dir, 'anthropic', 'fake-claude-key-123456')).toBe(true)
    const revision = keyStatus(dir, 'openai').revision
    expect(fs.readFileSync(aiKeyPath(dir, 'openai'), 'utf8')).not.toContain('fake-openai-key-123456')
    expect(readAiKey(dir, 'openai')).toBe('fake-openai-key-123456')
    saveAiKey(dir, 'openai', 'fake-openai-key-654321')
    expect(keyStatus(dir, 'openai').revision).not.toBe(revision)
    expect(deleteAiKey(dir, 'openai')).toBe(true)
    expect(keyStatus(dir, 'anthropic').keyReadable).toBe(true)
    expect(keyStatus(dir, 'openai').hasKey).toBe(false)
  })
  it('migrates and verifies the legacy Gemini file idempotently', () => {
    fs.writeFileSync(join(dir, 'gemini-key.enc'), 'encrypted:fake-legacy-key-123456')
    migrateGeminiKey(dir)
    expect(readAiKey(dir, 'gemini')).toBe('fake-legacy-key-123456')
    expect(fs.existsSync(join(dir, 'gemini-key.enc'))).toBe(false)
    const revision = keyStatus(dir, 'gemini').revision
    migrateGeminiKey(dir)
    expect(keyStatus(dir, 'gemini').revision).toBe(revision)
  })
  it('preserves the old key on migration failure and never overwrites a newer key', () => {
    fs.writeFileSync(join(dir, 'gemini-key.enc'), 'encrypted:fake-legacy-key-123456')
    encryption.fail = true; migrateGeminiKey(dir)
    expect(fs.existsSync(join(dir, 'gemini-key.enc'))).toBe(true)
    expect(readAiKey(dir, 'gemini')).toBe('fake-legacy-key-123456')
    encryption.fail = false
    saveAiKey(dir, 'gemini', 'fake-new-key-123456')
    migrateGeminiKey(dir)
    expect(readAiKey(dir, 'gemini')).toBe('fake-new-key-123456')
    deleteAiKey(dir, 'gemini')
    expect(fs.existsSync(join(dir, 'gemini-key.enc'))).toBe(false)
  })
  it('fails closed without encryption and reports unreadable ciphertext', () => {
    encryption.available = false
    expect(saveAiKey(dir, 'openai', 'fake-test-key-123456')).toBe(false)
    encryption.available = true
    saveAiKey(dir, 'openai', 'fake-test-key-123456')
    fs.writeFileSync(aiKeyPath(dir, 'openai'), 'broken')
    expect(keyStatus(dir, 'openai')).toMatchObject({ hasKey: true, keyReadable: false })
    expect(() => readAiKey(dir, 'openai')).toThrow('key-unreadable')
    expect(saveAiKey(dir, 'anthropic', 'bad key with whitespace')).toBe(false)
  })
  it('migrates a version-six database without changing old drafts or profiles', () => {
    const oldPath = join(dir, 'old.db')
    const old = new DatabaseSync(oldPath)
    const source = fs.readFileSync('src/storage/migrations.ts', 'utf8')
    for (const match of [...source.matchAll(/\/\* (\d+) \*\/ `([\s\S]*?)`/g)].filter(m => Number(m[1]) <= 6)) old.exec(match[2]!)
    old.exec("PRAGMA user_version=6; INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','123','https://mostaql.com/go/123','Project','now','now','live','now','now'); INSERT INTO proposal_drafts(project_id,proposal,updated_at) VALUES(1,'Earlier manual draft','2026-01-01'); INSERT INTO settings(key,value) VALUES('proposal-profile','{\"skills\":\"React\"}');")
    old.close()
    const migrated = openDatabase(oldPath)
    expect(getProposalDraft(migrated, 1)).toMatchObject({ proposal: 'Earlier manual draft', provider: null, model: null })
    expect(getSettingRaw(migrated, 'proposal-profile')).toContain('React')
    expect(getAiSettings(migrated).modelByProvider.gemini).toBe('gemini-2.5-flash')
    migrated.close()
  })
})
describe('proposal AI service consent and lifecycle', () => {
  it('invalidates preview for selection, notes, profile and key changes before any request', async () => {
    const fetchImpl = vi.fn(async () => reply()) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl)
    ai.saveKey('openai', 'fake-test-key-123456')
    const original = ai.preview(id, '', selection)!
    expect(ai.preview(id, 'changed', selection)?.fingerprint).not.toBe(original.fingerprint)
    expect(ai.preview(id, '', { provider: 'gemini', model: 'gemini-2.5-flash' })?.fingerprint).not.toBe(original.fingerprint)
    setSettingRaw(db, 'proposal-profile', JSON.stringify({ skills: 'React', experience: '', portfolio: '', tone: '', language: 'ar' }))
    expect(ai.preview(id, '', selection)?.fingerprint).not.toBe(original.fingerprint)
    ai.saveKey('openai', 'fake-test-key-654321')
    expect(await ai.generate(id, '', original.fingerprint, selection)).toMatchObject({ ok: false, error: 'preview-changed' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects Khamsat generation before any provider request', async () => {
    const khamsat = addProject('khamsat', 'khamsat-1', 'Khamsat excerpt')
    const fetchImpl = vi.fn(async () => reply()) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl)
    ai.saveKey('openai', 'fake-test-key-123456')
    expect(ai.preview(khamsat, '', selection)).toBeNull()
    expect(await ai.generate(khamsat, '', 'a'.repeat(64), selection)).toMatchObject({ ok: false, error: 'bad-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects a KAF preview approved from the excerpt after late details arrive, then allows a refreshed preview', async () => {
    const kaf = addProject('kaf', 'kaf-late-details', 'KAF list excerpt')
    const fetchImpl = vi.fn(async () => reply()) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl)
    ai.saveKey('openai', 'fake-test-key-123456')
    const excerptPreview = ai.preview(kaf, '', selection)!
    expect(excerptPreview).toMatchObject({ source: 'kaf', description: 'KAF list excerpt', provenance: 'excerpt' })
    upsertProjectDetails(db, kaf, { text: 'KAF detail brief arrived later', provenance: 'full', fetchedAt: new Date().toISOString(), status: 'ready', errorCode: null })
    expect(await ai.generate(kaf, '', excerptPreview.fingerprint, selection)).toMatchObject({ ok: false, error: 'preview-changed' })
    expect(fetchImpl).not.toHaveBeenCalled()
    const refreshed = ai.preview(kaf, '', selection)!
    expect(refreshed).toMatchObject({ description: 'KAF detail brief arrived later', provenance: 'full' })
    expect(refreshed.fingerprint).not.toBe(excerptPreview.fingerprint)
    expect(await ai.generate(kaf, '', refreshed.fingerprint, selection)).toMatchObject({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rejects a legacy v2 fingerprint without a request and saves new drafts as v3', async () => {
    const fetchImpl = vi.fn(async () => reply()) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl)
    ai.saveKey('openai', 'fake-test-key-123456')
    const preview = ai.preview(id, '', selection)!
    expect(preview.source).toBe('mostaql')
    expect(preview.promptVersion).toBe('proposal-v3')
    const legacyBase: Record<string, unknown> = { ...preview }
    delete legacyBase.source
    delete legacyBase.fingerprint
    const legacy = createHash('sha256').update(JSON.stringify({ ...legacyBase, promptVersion: 'proposal-v2', profileId: LEGACY_PROFILE_ID, revision: keyStatus(dir, 'openai').revision, capabilities: getCapabilities(db, dir, selection) })).digest('hex')
    expect(await ai.generate(id, '', legacy, selection)).toMatchObject({ ok: false, error: 'preview-changed' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await ai.generate(id, '', preview.fingerprint, selection)).toMatchObject({ ok: true })
    expect(getProposalDraft(db, id)?.promptVersion).toBe('proposal-v3')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('sends only the selected key and records draft provenance', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.headers).toHaveProperty('Authorization', 'Bearer fake-openai-key-123456')
      expect(JSON.stringify(init)).not.toContain('fake-gemini-key-123456')
      return reply()
    }) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl)
    ai.saveKey('openai', 'fake-openai-key-123456'); ai.saveKey('gemini', 'fake-gemini-key-123456')
    const p = ai.preview(id, '', selection)!
    expect(await ai.generate(id, '', p.fingerprint, selection)).toMatchObject({ ok: true })
    expect(getProposalDraft(db, id)).toMatchObject({ provider: 'openai', model: selection.model, proposal: 'A valid proposal' })
    expect(JSON.stringify(ai.setup())).not.toContain('fake-openai-key-123456')
  })
  it('tests with synthetic data and never stores a test as a project draft', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.body).toContain('Synthetic test profile only')
      expect(init?.body).not.toContain('Private real project')
      expect(init?.body).not.toContain('Secret portfolio')
      return reply()
    }) as typeof fetch
    setSettingRaw(db, 'proposal-profile', JSON.stringify({ skills: 'Secret portfolio', experience: '', portfolio: '', tone: '', language: 'ar' }))
    const ai = new AiService(db, dir, fetchImpl); ai.saveKey('openai', 'fake-test-key-123456')
    expect(await ai.test(selection)).toMatchObject({ ok: true })
    expect(getProposalDraft(db, id)).toBeNull()
    expect(ai.setup().providers.openai.verification?.model).toBe(selection.model)
    ai.saveKey('openai', 'fake-test-key-654321')
    expect(ai.setup().providers.openai.verification).toBeNull()
  })
  it('blocks concurrent tests and discards a late successful response after cancellation', async () => {
    let resolve!: (response: Response) => void
    const fetchImpl = vi.fn(() => new Promise<Response>(done => { resolve = done })) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl); ai.saveKey('openai', 'fake-test-key-123456')
    const p = ai.preview(id, '', selection)!
    const pending = ai.generate(id, '', p.fingerprint, selection)
    expect(await ai.test(selection)).toMatchObject({ error: 'busy' })
    ai.cancel(); resolve(reply())
    expect(await pending).toMatchObject({ ok: false, error: 'cancelled' })
    expect(getProposalDraft(db, id)).toBeNull()
    await ai.close()
    expect(await ai.test(selection)).toMatchObject({ error: 'cancelled' })
  })
  it('keeps saved catalogs on refresh failure and invalidates them on key rotation', async () => {
    let failed = false
    const ai = new AiService(db, dir, (async () => failed ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ data: [{ id: selection.model }] }))) as typeof fetch)
    ai.saveKey('openai', 'fake-test-key-123456')
    expect(await ai.listModels('openai')).toMatchObject({ ok: true })
    failed = true
    expect(await ai.listModels('openai')).toMatchObject({ error: 'provider-unavailable' })
    expect(ai.setup().providers.openai.catalog?.models[0]?.id).toBe(selection.model)
    ai.saveKey('openai', 'fake-test-key-654321')
    expect(ai.setup().providers.openai.catalog).toBeNull()
  })
  it('times out a request and never retries or persists the late result', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))) as typeof fetch
    const ai = new AiService(db, dir, fetchImpl); ai.saveKey('openai', 'fake-test-key-123456')
    const result = ai.test(selection)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(await result).toMatchObject({ error: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(getProposalDraft(db, id)).toBeNull()
  })
  it('keeps AI selections independent of the freelancer profile', () => {
    setSettingRaw(db, 'proposal-profile', 'keep-this-profile')
    const settings = defaultAiSettings(); settings.activeProvider = 'anthropic'; settings.modelByProvider.anthropic = 'claude-sonnet-4-5'
    expect(saveAiSettings(db, settings)).toBe(true)
    expect(getAiSettings(db).activeProvider).toBe('anthropic')
    expect(getSettingRaw(db, 'proposal-profile')).toBe('keep-this-profile')
  })
})

function standingService(fetchImpl: typeof fetch, measured = vi.fn()): AiService {
  const ai = new AiService(db, dir, fetchImpl, () => {}, measured)
  ai.saveKey('openai', 'fake-standing-key-123456')
  ai.saveSettings({ ...defaultAiSettings(), activeProvider: 'openai', modelByProvider: { ...defaultAiSettings().modelByProvider, openai: selection.model } })
  return ai
}
describe('standing Quick Apply consent', () => {
  it('defaults off, rejects corrupt records and binds to provider, model and key with no A-B-A resurrection', () => {
    const ai = standingService(vi.fn(async () => reply()) as typeof fetch)
    expect(ai.standingAllowed()).toBe(false)
    expect(ai.setStandingConsent(true, { ...selection, model: 'wrong-model' })).toBe(false)
    for (const raw of ['oops', 'null', '{}', '{"version":1}', '[]']) {
      setSettingRaw(db, 'ai-quick-consent', raw)
      expect(ai.standingAllowed()).toBe(false)
    }
    expect(ai.setStandingConsent(true, selection)).toBe(true)
    expect(ai.standingAllowed()).toBe(true)
    const original = ai.setup().settings
    ai.saveSettings({ ...original, modelByProvider: { ...original.modelByProvider, openai: 'other-model' } })
    ai.saveSettings(original)
    expect(ai.standingAllowed()).toBe(false)
    expect(getSettingRaw(db, 'ai-quick-consent')).toBeNull()
    ai.setStandingConsent(true, selection)
    ai.saveSettings({ ...original, activeProvider: 'gemini' })
    ai.saveSettings(original)
    expect(ai.standingAllowed()).toBe(false)
    ai.setStandingConsent(true, selection)
    ai.saveKey('gemini', 'fake-other-provider-123456')
    expect(ai.standingAllowed()).toBe(false)
    ai.setStandingConsent(true, selection)
    ai.deleteKey('gemini')
    expect(ai.standingAllowed()).toBe(false)
  })
  it('uses the normal prompt with empty notes and exactly one unchanged generation metric', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const measured = vi.fn(), fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).input[0].content[0].text).toContain('PROJECT-SPECIFIC USER NOTES:\n""\n')
      return reply()
    }) as typeof fetch
    const ai = standingService(fetchImpl, measured)
    expect(await ai.generateStanding(id, 'operation')).toMatchObject({ error: 'consent-required' })
    expect(fetchImpl).not.toHaveBeenCalled()
    ai.setStandingConsent(true, selection)
    expect(await ai.generateStanding(id, 'operation')).toMatchObject({ ok: true })
    expect(getProposalDraft(db, id)?.proposal).toBe('A valid proposal')
    expect(measured).toHaveBeenCalledTimes(1)
    expect(measured.mock.calls[0]![0]).toEqual({ provider: 'openai', outcome: 'success', error: 'none', duration: 'under_100ms' })
    await ai.close()
  })
  it.each(['cancel', 'revoke', 'delete-key', 'rotate-key', 'selection', 'close'])('discards late responses after %s without touching a concurrent saved draft', async action => {
    let resolve!: (value: Response) => void
    const measured = vi.fn()
    const ai = standingService(vi.fn(() => new Promise<Response>(done => { resolve = done })) as typeof fetch, measured)
    ai.setStandingConsent(true, selection)
    const pending = ai.generateStanding(id, 'owned')
    ai.cancelStanding('someone-else')
    if (action === 'cancel') ai.cancelStanding('owned')
    if (action === 'revoke') ai.setStandingConsent(false)
    if (action === 'delete-key') ai.deleteKey('openai')
    if (action === 'rotate-key') ai.saveKey('openai', 'fake-rotated-key-123456')
    if (action === 'selection') ai.saveSettings(defaultAiSettings())
    const closing = action === 'close' ? ai.close() : null
    saveProposalDraft(db, { projectId: id, proposal: 'Concurrent manual text', assumptions: [], questions: [], updatedAt: 'now' })
    resolve(reply())
    expect(await pending).toMatchObject({ error: 'cancelled' })
    await closing
    expect(getProposalDraft(db, id)?.proposal).toBe('Concurrent manual text')
    expect(measured).toHaveBeenCalledTimes(1)
    expect(measured.mock.calls[0]![0].outcome).toBe('cancelled')
    await ai.close()
  })
  it('preserves a draft saved during generation and reports text-changed', async () => {
    let resolve!: (value: Response) => void
    const ai = standingService(vi.fn(() => new Promise<Response>(done => { resolve = done })) as typeof fetch)
    ai.setStandingConsent(true, selection)
    const pending = ai.generateStanding(id, 'owned')
    expect(await ai.test(selection)).toMatchObject({ error: 'busy' })
    saveProposalDraft(db, { projectId: id, proposal: 'My edit', assumptions: [], questions: [], updatedAt: 'now' })
    resolve(reply())
    expect(await pending).toMatchObject({ error: 'text-changed' })
    expect(getProposalDraft(db, id)?.proposal).toBe('My edit')
    await ai.close()
  })
  it.each([10001, 12000, 12001])('validates generated text of length %s before conditional save', async length => {
    const ai = standingService((async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ proposal: 'x'.repeat(length), assumptions: [], questions: [] }) }] }] }))) as typeof fetch)
    ai.setStandingConsent(true, selection)
    const result = await ai.generateStanding(id, 'owned')
    expect(result.ok).toBe(length <= 12000)
    if (length > 12000) { expect(result.error).toBe('invalid-response'); expect(getProposalDraft(db, id)).toBeNull() }
    else expect(getProposalDraft(db, id)?.proposal.length).toBe(length)
    await ai.close()
  })
})

it('records exactly one generation event despite failed activation and saved-draft retries', async () => {
  const measured = vi.fn(), fetchImpl = vi.fn(async () => reply()) as typeof fetch
  const ai = standingService(fetchImpl, measured)
  ai.setStandingConsent(true, selection)
  const broker = {
    preflight: () => ({ ok: true }), reserve: () => true, release: () => {}, status: () => ({ selectedId: 'client' }),
    quick: vi.fn(async () => ({ ok: false, error: 'chrome-unavailable' })), cancelOwned: () => {}, ownsJob: () => false
  }
  const assistant = new QuickAssistant(db, ai, broker as unknown as ExtensionBroker, () => true, () => {})
  expect(await assistant.quick(id)).toEqual({ ok: false, error: 'chrome-unavailable' })
  expect(getProposalDraft(db, id)?.proposal).toBe('A valid proposal')
  expect(await assistant.quick(id)).toEqual({ ok: false, error: 'chrome-unavailable' })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(measured).toHaveBeenCalledTimes(1)
  expect(Object.keys(measured.mock.calls[0]![0]).sort()).toEqual(['duration', 'error', 'outcome', 'provider'])
  expect(broker.quick).toHaveBeenCalledTimes(2)
  await ai.close()
})
it('generates exactly one event for Nafezly and none when reusing its saved draft', async () => {
  const nafezly = addProject('nafezly', 'nafezly-1', 'Nafezly public excerpt')
  const measured = vi.fn(), fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).input[0].content[0].text).toContain('for a Nafezly project')
    return reply()
  }) as typeof fetch
  const ai = standingService(fetchImpl, measured)
  ai.setStandingConsent(true, selection)
  const broker = {
    preflight: () => ({ ok: true }), reserve: () => true, release: () => {}, status: () => ({ selectedId: 'client' }),
    quick: vi.fn(async () => ({ ok: false, error: 'chrome-unavailable' })), cancelOwned: () => {}, ownsJob: () => false
  }
  const assistant = new QuickAssistant(db, ai, broker as unknown as ExtensionBroker, () => true, () => {})
  expect(await assistant.quick(nafezly)).toEqual({ ok: false, error: 'chrome-unavailable' })
  expect(getProposalDraft(db, nafezly)?.proposal).toBe('A valid proposal')
  expect(await assistant.quick(nafezly)).toEqual({ ok: false, error: 'chrome-unavailable' })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(measured).toHaveBeenCalledTimes(1)
  expect(Object.keys(measured.mock.calls[0]![0]).sort()).toEqual(['duration', 'error', 'outcome', 'provider'])
  expect(broker.quick).toHaveBeenCalledTimes(2)
  await ai.close()
})
