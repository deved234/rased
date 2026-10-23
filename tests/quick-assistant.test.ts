import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDatabase, type Db } from '../src/storage/db.js'
import { getProposalDraft, saveProposalDraft } from '../src/storage/proposalDrafts.js'
import { upsertProjectsBatch } from '../src/storage/repositories.js'
import { QuickAssistant } from '../src/main/extension/quickAssistant.js'
import type { AiService } from '../src/main/ai/service.js'
import type { ExtensionBroker } from '../src/main/extension/broker.js'
import type { ProposalResult } from '../src/shared/proposals.js'
import type { QuickApplyResult } from '../src/shared/quickApply.js'

let db: Db, id: number
beforeEach(() => {
  db = openDatabase(':memory:')
  id = upsertProjectsBatch(db, [{ source: 'mostaql', externalId: '1', url: 'https://mostaql.com/project/1', title: 'Fixture', descriptionExcerpt: 'Public', publishedAt: null, publishedRaw: null }], { now: 'now', discoveryKind: 'initial' }).insertedIds[0]!
})
afterEach(() => db.close())
function project(source: string, externalId: string): number {
  return upsertProjectsBatch(db, [{ source, externalId, url: `https://example.test/${source}/${externalId}`, title: 'Fixture', descriptionExcerpt: 'Public', publishedAt: null, publishedRaw: null }], { now: 'now', discoveryKind: 'initial' }).insertedIds[0]!
}
function fixture() {
  let allowed = true, consent = true, selected = 'client', reserved: string | null = null
  let resolve!: (result: ProposalResult) => void
  const ai = {
    standingPreflight: vi.fn(() => consent ? null : 'consent-required'),
    standingAllowed: () => consent,
    generateStanding: vi.fn(() => new Promise<ProposalResult>(done => { resolve = done })),
    cancelStanding: vi.fn()
  }
  const broker = {
    preflight: vi.fn((): QuickApplyResult => ({ ok: true })),
    reserve: vi.fn((owner: string) => { if (reserved) return false; reserved = owner; return true }),
    release: vi.fn((owner: string) => { if (reserved === owner) reserved = null }),
    cancelOwned: vi.fn(), ownsJob: vi.fn(() => false), status: () => ({ selectedId: selected }),
    quick: vi.fn(async (): Promise<QuickApplyResult> => ({ ok: true }))
  }
  const assistant = new QuickAssistant(db, ai as unknown as AiService, broker as unknown as ExtensionBroker, () => allowed, vi.fn())
  return { assistant, ai, broker, resolve: (result: ProposalResult) => resolve(result), revoke: () => { consent = false }, block: () => { allowed = false }, select: () => { selected = 'other' } }
}
it('reuses saved drafts without generation or standing consent', async () => {
  const f = fixture(); f.revoke()
  saveProposalDraft(db, { projectId: id, proposal: 'Saved', assumptions: [], questions: [], updatedAt: 'now' })
  expect(await f.assistant.quick(id)).toEqual({ ok: true })
  expect(f.ai.generateStanding).not.toHaveBeenCalled()
  expect(f.ai.standingPreflight).not.toHaveBeenCalled()
  expect(f.broker.quick).toHaveBeenCalledWith(id, 'draft', undefined, expect.any(String))
})
it('preflights before paid generation, reserves one operation and ignores cancellation for another identity', async () => {
  const f = fixture(); f.revoke()
  expect(await f.assistant.quick(id)).toMatchObject({ error: 'consent-required' })
  expect(f.ai.generateStanding).not.toHaveBeenCalled()
  const other = fixture()
  other.broker.preflight.mockReturnValue({ ok: false, error: 'not-ready' })
  expect(await other.assistant.quick(id)).toMatchObject({ error: 'not-ready' })
  expect(other.ai.generateStanding).not.toHaveBeenCalled()
  other.broker.preflight.mockReturnValue({ ok: true })
  const pending = other.assistant.quick(id)
  expect(other.assistant.status()?.phase).toBe('writing')
  const owner = other.assistant.status()!.operationId
  expect(other.broker.reserve).toHaveBeenCalledWith(owner)
  expect(await other.assistant.quick(id)).toMatchObject({ error: 'busy' })
  other.assistant.cancel('wrong-owner')
  expect(other.ai.cancelStanding).not.toHaveBeenCalled()
  other.resolve({ ok: true })
  expect(await pending).toEqual({ ok: true })
  expect(other.broker.release).toHaveBeenCalledWith(owner)
  expect(other.assistant.status()).toBeNull()
})
it.each(['cancel', 'withdraw', 'consent', 'destination', 'dispose'])('rejects a late generation after %s', async action => {
  const f = fixture(), pending = f.assistant.quick(id)
  if (action === 'cancel') f.assistant.cancel(f.assistant.status()!.operationId)
  if (action === 'withdraw') f.block()
  if (action === 'consent') f.revoke()
  if (action === 'destination') f.select()
  if (action === 'dispose') f.assistant.dispose()
  f.resolve({ ok: true })
  expect((await pending).ok).toBe(false)
  expect(f.broker.quick).not.toHaveBeenCalled()
  expect(f.assistant.status()).toBeNull()
})
it('cancels only its owned job during Chrome launch and preserves a generated draft on launch failure', async () => {
  const f = fixture()
  let finish!: (result: QuickApplyResult) => void
  f.broker.quick.mockImplementation(() => new Promise(done => { finish = done }))
  const pending = f.assistant.quick(id)
  const owner = f.assistant.status()!.operationId
  saveProposalDraft(db, { projectId: id, proposal: 'Generated', assumptions: [], questions: [], updatedAt: 'now' })
  f.resolve({ ok: true }); await Promise.resolve(); await Promise.resolve()
  expect(f.assistant.status()?.phase).toBe('opening')
  f.assistant.cancel(owner)
  expect(f.broker.cancelOwned).toHaveBeenCalledWith(owner)
  finish({ ok: false, error: 'chrome-unavailable' })
  expect(await pending).toMatchObject({ error: 'cancelled' })
  expect(getProposalDraft(db, id)?.proposal).toBe('Generated')
})
it('reuses an old v2 Nafezly draft without consent, a key or regeneration', async () => {
  const nafezly = project('nafezly', 'reuse'), f = fixture(); f.revoke()
  saveProposalDraft(db, { projectId: nafezly, proposal: 'Earlier v2 text', assumptions: ['Old'], questions: [], updatedAt: '2026-01-01', provider: 'openai', model: 'gpt-example', promptVersion: 'proposal-v2', generatedAt: '2026-01-01' })
  const before = getProposalDraft(db, nafezly)
  expect(await f.assistant.quick(nafezly)).toEqual({ ok: true })
  expect(f.ai.generateStanding).not.toHaveBeenCalled()
  expect(f.ai.standingPreflight).not.toHaveBeenCalled()
  expect(f.broker.quick).toHaveBeenCalledWith(nafezly, 'draft', undefined, expect.any(String))
  expect(getProposalDraft(db, nafezly)).toEqual(before)
  saveProposalDraft(db, { ...before!, proposal: 'Edited v2 text', updatedAt: '2026-01-02' })
  expect(getProposalDraft(db, nafezly)).toMatchObject({ proposal: 'Edited v2 text', promptVersion: 'proposal-v2', provider: 'openai', model: 'gpt-example' })
})
it('generates a missing Nafezly draft and hands exactly that project to the broker', async () => {
  const nafezly = project('nafezly', 'generate'), f = fixture()
  const pending = f.assistant.quick(nafezly)
  const owner = f.assistant.status()!.operationId
  saveProposalDraft(db, { projectId: nafezly, proposal: 'Generated for Nafezly', assumptions: [], questions: [], updatedAt: 'now', promptVersion: 'proposal-v3' })
  f.resolve({ ok: true })
  expect(await pending).toEqual({ ok: true })
  expect(f.ai.generateStanding).toHaveBeenCalledTimes(1)
  expect(f.ai.generateStanding).toHaveBeenCalledWith(nafezly, owner)
  expect(f.broker.quick).toHaveBeenCalledTimes(1)
  expect(f.broker.quick).toHaveBeenCalledWith(nafezly, 'draft', undefined, owner)
  expect(getProposalDraft(db, nafezly)?.proposal).toBe('Generated for Nafezly')
})
it.each(['kaf', 'khamsat'])('rejects %s before reservation even with a seeded draft', async source => {
  const rejected = project(source, 'rejected'), f = fixture()
  saveProposalDraft(db, { projectId: rejected, proposal: 'Saved', assumptions: [], questions: [], updatedAt: 'now' })
  expect(await f.assistant.quick(rejected)).toEqual({ ok: false, error: 'unsupported-source' })
  expect(f.ai.generateStanding).not.toHaveBeenCalled()
  expect(f.broker.preflight).not.toHaveBeenCalled()
  expect(f.broker.reserve).not.toHaveBeenCalled()
  expect(f.broker.quick).not.toHaveBeenCalled()
  expect(f.assistant.status()).toBeNull()
})
