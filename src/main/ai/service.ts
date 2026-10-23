import { getSettingRaw, setSettingRaw } from '../../storage/repositories.js'
import { clearQuickConsent } from '../../storage/quickConsent.js'
import type { Db } from '../../storage/db.js'
import { getProposalPreview, generateProposalDraft } from '../proposals.js'
import { saveProposalDraft } from '../../storage/proposalDrafts.js'
import { PROMPT_VERSION, retryAfter, safeAiError, type AiOperationResult, type AiProviderId, sanitizeSelection, sanitizeAiSettings, type AiSelection } from '../../shared/ai.js'
import type { ProposalPreview, ProposalResult } from '../../shared/proposals.js'
import { deleteAiKey, keyStatus, readAiKey, saveAiKey } from './keyStore.js'
import { getAiSetup, getAiSettings, saveAiSettings, getCapabilities, saveCatalog, saveVerification } from './settings.js'
import { listProviderModels } from './providers.js'
import { durationBucket, telemetryError, type TelemetryEvents } from '../../shared/telemetry.js'

export class AiService {
  private active: { provider: AiProviderId; controller: AbortController; owner?: string } | null = null
  private catalogs = new Map<AiProviderId, AbortController>()
  private jobs = new Set<Promise<unknown>>()
  private closed = false
  constructor(private db: Db, private userData: string, private fetchImpl: typeof fetch = fetch, private audit: (message: string) => void = () => {}, private measured: (result: TelemetryEvents['proposal_result']) => void = () => {}) {}
  setup(): ReturnType<typeof getAiSetup> { return { ...getAiSetup(this.db, this.userData), quickConsent: this.standingAllowed() } }
  private selection(): AiSelection | null {
    const settings = getAiSettings(this.db)
    return sanitizeSelection({ provider: settings.activeProvider, model: settings.modelByProvider[settings.activeProvider] })
  }
  standingAllowed(): boolean {
    const selection = this.selection()
    if (!selection) return false
    const key = keyStatus(this.userData, selection.provider)
    try {
      const value = JSON.parse(getSettingRaw(this.db, 'ai-quick-consent') ?? 'null')
      return !!value && value.version === 1 && value.provider === selection.provider && value.model === selection.model && value.keyRevision === key.revision && key.keyReadable && typeof value.grantedAt === 'string' && Number.isFinite(Date.parse(value.grantedAt))
    } catch { return false }
  }
  setStandingConsent(enabled: boolean, expected?: AiSelection): boolean {
    if (!enabled) { clearQuickConsent(this.db); if (this.active?.owner) this.active.controller.abort(); return true }
    const selection = this.selection()
    if (!selection || !expected || selection.provider !== expected.provider || selection.model !== expected.model) return false
    const key = keyStatus(this.userData, selection.provider)
    if (!key.keyReadable) return false
    setSettingRaw(this.db, 'ai-quick-consent', JSON.stringify({ version: 1, ...selection, keyRevision: key.revision, grantedAt: new Date().toISOString() }))
    return true
  }
  saveSettings(value: unknown): boolean {
    const next = sanitizeAiSettings(value), previous = getAiSettings(this.db)
    if (!next) return false
    if (next.activeProvider !== previous.activeProvider || next.modelByProvider[next.activeProvider] !== previous.modelByProvider[previous.activeProvider]) this.setStandingConsent(false)
    return saveAiSettings(this.db, next)
  }
  standingPreflight(): string | null {
    const selection = this.selection()
    if (!selection) return 'bad-request'
    if (!keyStatus(this.userData, selection.provider).keyReadable) return 'no-key'
    return this.standingAllowed() ? null : 'consent-required'
  }
  generateStanding(id: number, owner: string): Promise<ProposalResult> {
    const error = this.standingPreflight()
    if (error) return Promise.resolve({ ok: false, error })
    const preview = this.preview(id, '', this.selection()!)
    if (!preview) return Promise.resolve({ ok: false, error: 'bad-request' })
    return this.run(preview, false, owner)
  }
  cancelStanding(owner: string): void { if (this.active?.owner === owner) this.active.controller.abort() }
  preview(id: number, notes: string, selection: AiSelection): ProposalPreview | null {
    return getProposalPreview(this.db, id, notes, selection, keyStatus(this.userData, selection.provider).revision, getCapabilities(this.db, this.userData, selection))
  }
  private cancelProvider(provider: AiProviderId): void { if (this.active?.provider === provider) this.active.controller.abort(); this.catalogs.get(provider)?.abort() }
  saveKey(provider: AiProviderId, key: unknown): boolean {
    const ok = saveAiKey(this.userData, provider, key)
    if (ok) { this.setStandingConsent(false); this.cancelProvider(provider) }
    return ok
  }
  deleteKey(provider: AiProviderId): boolean { this.setStandingConsent(false); this.cancelProvider(provider); return deleteAiKey(this.userData, provider) }
  cancel(): void { this.active?.controller.abort() }
  cancelManual(): void { if (!this.active?.owner) this.active?.controller.abort() }
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
  private run(preview: ProposalPreview, test: boolean, owner?: string): Promise<ProposalResult & AiOperationResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'cancelled' })
    if (this.active) return Promise.resolve({ ok: false, error: 'busy' })
    const controller = new AbortController()
    this.active = { provider: preview.provider, controller, owner }
    return this.track((async () => {
      const start = Date.now()
      const revision = keyStatus(this.userData, preview.provider).revision
      const capabilities = getCapabilities(this.db, this.userData, preview)
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 45_000)
      try {
        const draft = await generateProposalDraft(this.userData, preview, controller.signal, capabilities, this.fetchImpl)
        if (controller.signal.aborted || this.closed || keyStatus(this.userData, preview.provider).revision !== revision) throw new Error('cancelled')
        if (owner && !this.standingAllowed()) throw new Error('cancelled')
        const saved = test || saveProposalDraft(this.db, draft, owner !== undefined)
        const testedAt = new Date().toISOString()
        saveVerification(this.db, preview.provider, { model: preview.model, revision, testedAt })
        this.audit(`ai ${test ? 'test' : 'generate'} ${preview.provider} ${preview.model} ok ${Date.now() - start}ms`)
        if (!test) this.measured({ provider: preview.provider, outcome: 'success', error: 'none', duration: durationBucket(Date.now() - start) })
        if (!saved) return { ok: false, error: 'text-changed' }
        return test ? { ok: true, testedAt, elapsedMs: Date.now() - start } : { ok: true, draft }
      } catch (error) {
        const code = timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : safeAiError(error)
        this.audit(`ai ${test ? 'test' : 'generate'} ${preview.provider} ${preview.model} ${code} ${Date.now() - start}ms`)
        if (!test) this.measured({ provider: preview.provider, outcome: code === 'cancelled' ? 'cancelled' : 'failed', error: telemetryError(code), duration: durationBucket(Date.now() - start) })
        return { ok: false, error: code, retryAfterSeconds: retryAfter(error) }
      } finally { clearTimeout(timeout); if (this.active?.controller === controller) this.active = null }
    })())
  }
}
