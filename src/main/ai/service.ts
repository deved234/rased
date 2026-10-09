import type { Db } from '../../storage/db.js'
import { getProposalPreview, generateProposalDraft } from '../proposals.js'
import { saveProposalDraft } from '../../storage/proposalDrafts.js'
import { PROMPT_VERSION, retryAfter, safeAiError, type AiOperationResult, type AiProviderId, type AiSelection } from '../../shared/ai.js'
import type { ProposalPreview, ProposalResult } from '../../shared/proposals.js'
import { deleteAiKey, keyStatus, readAiKey, saveAiKey } from './keyStore.js'
import { getAiSetup, getCapabilities, saveCatalog, saveVerification } from './settings.js'
import { listProviderModels } from './providers.js'

export class AiService {
  private active: { provider: AiProviderId; controller: AbortController } | null = null
  private catalogs = new Map<AiProviderId, AbortController>()
  private jobs = new Set<Promise<unknown>>()
  private closed = false
  constructor(private db: Db, private userData: string, private fetchImpl: typeof fetch = fetch, private audit: (message: string) => void = () => {}) {}
  setup(): ReturnType<typeof getAiSetup> { return getAiSetup(this.db, this.userData) }
  preview(id: number, notes: string, selection: AiSelection): ProposalPreview | null {
    return getProposalPreview(this.db, id, notes, selection, keyStatus(this.userData, selection.provider).revision, getCapabilities(this.db, this.userData, selection))
  }
  private cancelProvider(provider: AiProviderId): void { if (this.active?.provider === provider) this.active.controller.abort(); this.catalogs.get(provider)?.abort() }
  saveKey(provider: AiProviderId, key: unknown): boolean {
    const ok = saveAiKey(this.userData, provider, key)
    if (ok) this.cancelProvider(provider)
    return ok
  }
  deleteKey(provider: AiProviderId): boolean { this.cancelProvider(provider); return deleteAiKey(this.userData, provider) }
  cancel(): void { this.active?.controller.abort() }
  async close(): Promise<void> {
    this.closed = true; this.cancel()
    for (const controller of this.catalogs.values()) controller.abort()
    await Promise.allSettled([...this.jobs])
  }
  private track<T>(promise: Promise<T>): Promise<T> { this.jobs.add(promise); void promise.finally(() => this.jobs.delete(promise)).catch(() => {}); return promise }
  listModels(provider: AiProviderId): Promise<AiOperationResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'cancelled' })
    if (this.catalogs.has(provider)) return Promise.resolve({ ok: false, error: 'busy' })
    const controller = new AbortController()
    this.catalogs.set(provider, controller)
    return this.track((async () => {
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 15_000)
      const revision = keyStatus(this.userData, provider).revision
      try {
        const models = await listProviderModels(provider, readAiKey(this.userData, provider), controller.signal, this.fetchImpl)
        if (controller.signal.aborted || this.closed || keyStatus(this.userData, provider).revision !== revision) return { ok: false, error: 'cancelled' }
        const catalog = { models, fetchedAt: new Date().toISOString() }
        saveCatalog(this.db, provider, catalog, revision)
        return { ok: true, catalog }
      } catch (error) { return { ok: false, error: timedOut ? 'timeout' : safeAiError(error), retryAfterSeconds: retryAfter(error) } }
      finally { clearTimeout(timeout); if (this.catalogs.get(provider) === controller) this.catalogs.delete(provider) }
    })())
  }
  generate(id: number, notes: string, fingerprint: string, selection: AiSelection): Promise<ProposalResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'cancelled' })
    const preview = this.preview(id, notes, selection)
    if (!preview || preview.fingerprint !== fingerprint) return Promise.resolve({ ok: false, error: 'preview-changed' })
    return this.run(preview, false)
  }
  test(selection: AiSelection): Promise<AiOperationResult> {
    const preview: ProposalPreview = {
      projectId: 0, title: 'Synthetic test: small dashboard', description: 'Create a small dashboard. This is fictional test data.', provenance: 'full', category: 'Development', skills: ['React'], budget: null,
      profile: { skills: 'React', experience: 'Synthetic test profile only', portfolio: '', tone: 'concise', language: 'en' }, projectNotes: '', fingerprint: 'synthetic', ...selection, promptVersion: PROMPT_VERSION
    }
    return this.run(preview, true)
  }
  private run(preview: ProposalPreview, test: boolean): Promise<ProposalResult & AiOperationResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'cancelled' })
    if (this.active) return Promise.resolve({ ok: false, error: 'busy' })
    const controller = new AbortController()
    this.active = { provider: preview.provider, controller }
    return this.track((async () => {
      const start = Date.now()
      const revision = keyStatus(this.userData, preview.provider).revision
      const capabilities = getCapabilities(this.db, this.userData, preview)
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 45_000)
      try {
        const draft = await generateProposalDraft(this.userData, preview, controller.signal, capabilities, this.fetchImpl)
        if (controller.signal.aborted || this.closed || keyStatus(this.userData, preview.provider).revision !== revision) throw new Error('cancelled')
        if (!test) saveProposalDraft(this.db, draft)
        const testedAt = new Date().toISOString()
        saveVerification(this.db, preview.provider, { model: preview.model, revision, testedAt })
        this.audit(`ai ${test ? 'test' : 'generate'} ${preview.provider} ${preview.model} ok ${Date.now() - start}ms`)
        return test ? { ok: true, testedAt, elapsedMs: Date.now() - start } : { ok: true, draft }
      } catch (error) {
        const code = timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : safeAiError(error)
        this.audit(`ai ${test ? 'test' : 'generate'} ${preview.provider} ${preview.model} ${code} ${Date.now() - start}ms`)
        return { ok: false, error: code, retryAfterSeconds: retryAfter(error) }
      } finally { clearTimeout(timeout); if (this.active?.controller === controller) this.active = null }
    })())
  }
}
