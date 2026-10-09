import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, type Db } from '../src/storage/db.js'
import { getSettingRaw, setSettingRaw, upsertProjectsBatch } from '../src/storage/repositories.js'
import { getProposalDraft } from '../src/storage/proposalDrafts.js'
import { AiService } from '../src/main/ai/service.js'
import { aiKeyPath, deleteAiKey, keyStatus, migrateGeminiKey, readAiKey, saveAiKey } from '../src/main/ai/keyStore.js'
import { getAiSettings, saveAiSettings } from '../src/main/ai/settings.js'
import { defaultAiSettings, type AiSelection } from '../src/shared/ai.js'

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
