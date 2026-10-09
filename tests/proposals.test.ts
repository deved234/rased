import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { countPurgeable, purgeHistory, upsertProjectsBatch, upsertProjectDetails } from '../src/storage/repositories.js'
import { deleteProposalDraft, getProposalDraft, saveProposalDraft } from '../src/storage/proposalDrafts.js'
import { buildProposalPrompt, generateProposalDraft, getProposalPreview, parseProposalDraft, saveProposalProfile } from '../src/main/proposals.js'

import { deleteAiKey, keyStatus, saveAiKey } from '../src/main/ai/keyStore.js'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '') } }))

describe('proposal assistant data boundaries', () => {
  let dir: string
  let db: Db
  let id: number
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rased-proposals-'))
    db = openDatabase(join(dir, 'rased.db'))
    const inserted = upsertProjectsBatch(db, [{ source: 'mostaql', externalId: 'proposal-test', url: 'https://mostaql.com/project/1', title: 'Build dashboard', descriptionExcerpt: 'RSS excerpt', publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'live' })
    id = inserted.insertedIds[0]!
  })
  afterEach(() => { closeDatabase(db); rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('previews exactly the saved public fields and explicit profile, never a private note', () => {
    expect(saveProposalProfile(db, { skills: 'React', experience: 'Three dashboards', portfolio: '', tone: 'direct', language: 'en' })).not.toBeNull()
    upsertProjectDetails(db, id, { text: 'Full client brief', provenance: 'full', fetchedAt: new Date().toISOString(), status: 'ready', errorCode: null })
    const preview = getProposalPreview(db, id, 'I can deliver next week')!
    expect(preview.description).toBe('Full client brief')
    expect(preview.provenance).toBe('full')
    expect(preview.profile.skills).toBe('React')
    expect(buildProposalPrompt(preview)).toContain('Full client brief')
    expect(buildProposalPrompt(preview)).toContain('untrusted client content')
    expect(getProposalPreview(db, id, 'different')?.fingerprint).not.toBe(preview.fingerprint)
  })

  it('encrypts the key outside SQLite and makes a single bounded Gemini request', async () => {
    expect(saveAiKey(dir, 'gemini', 'fake-test-key-123456')).toBe(true)
    expect(keyStatus(dir, 'gemini').hasKey).toBe(true)
    const mock = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toContain('gemini-2.5-flash')
      expect(options.headers).toHaveProperty('x-goog-api-key', 'fake-test-key-123456')
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ proposal: 'Hello client', assumptions: ['Timeline unclear'], questions: ['Any design?'] }) }] } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', mock)
    const draft = await generateProposalDraft(dir, getProposalPreview(db, id, '')!, new AbortController().signal)
    expect(draft.proposal).toBe('Hello client')
    expect(mock).toHaveBeenCalledTimes(1)
    const request = mock.mock.calls[0]
    expect(request?.[0]).toContain('gemini-2.5-flash')
    expect((request?.[1] as RequestInit).headers).toHaveProperty('x-goog-api-key', 'fake-test-key-123456')
    const body = JSON.parse(String((request?.[1] as RequestInit).body))
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0)
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048)
    deleteAiKey(dir, 'gemini')
    expect(keyStatus(dir, 'gemini').hasKey).toBe(false)
  })

  it('reports token-limited responses instead of treating partial JSON as a bad key', async () => {
    expect(saveAiKey(dir, 'gemini', 'fake-test-key-123456')).toBe(true)
    const truncated = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"proposal":"incomplete' }] } }] }), { status: 200 }))
    await expect(generateProposalDraft(dir, getProposalPreview(db, id, '')!, new AbortController().signal, undefined, truncated as typeof fetch)).rejects.toThrow('output-truncated')
  })

  it('persists and deletes editable drafts without touching projects', () => {
    const draft = parseProposalDraft({ proposal: 'Work plan', assumptions: [], questions: [] }, id)!
    saveProposalDraft(db, draft)
    expect(getProposalDraft(db, id)?.proposal).toBe('Work plan')
    expect(countPurgeable(db, '2099-01-01T00:00:00.000Z', ['live'])).toBe(0)
    expect(purgeHistory(db, '2099-01-01T00:00:00.000Z', ['live']).deleted).toBe(0)
    deleteProposalDraft(db, id)
    expect(getProposalDraft(db, id)).toBeNull()
    expect(getProposalPreview(db, id, '')?.title).toBe('Build dashboard')
  })
})
