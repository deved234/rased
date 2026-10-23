import { randomUUID } from 'node:crypto'
import type { Db } from '../../storage/db.js'
import { getProjectById } from '../../storage/repositories.js'
import { getProposalDraft } from '../../storage/proposalDrafts.js'
import { AI_ERROR_CODES } from '../../shared/ai.js'
import type { QuickAssistantResult } from '../../shared/quickApply.js'
import type { AiService } from '../ai/service.js'
import type { ExtensionBroker } from './broker.js'

export class QuickAssistant {
  private active: { operationId: string; projectId: number; phase: 'writing' | 'opening' } | null = null
  private pendingOwner: string | null = null
  private closed = false
  constructor(private db: Db, private ai: AiService, private broker: ExtensionBroker, private allowed: () => boolean, private changed: () => void) {}
  status(): typeof this.active {
    if (this.pendingOwner && !this.broker.ownsJob(this.pendingOwner)) this.pendingOwner = null
    return this.active ? { ...this.active } : null
  }
  cancel(operationId?: string): void {
    const owner = this.active?.operationId ?? this.pendingOwner
    if (!owner || (operationId !== undefined && owner !== operationId)) return
    this.active = null
    this.pendingOwner = null
    this.ai.cancelStanding(owner)
    this.broker.cancelOwned(owner)
    this.changed()
  }
  dispose(): void { this.closed = true; this.cancel() }
  async quick(projectId: number): Promise<QuickAssistantResult> {
    if (this.closed || !this.allowed()) return { ok: false, error: 'blocked' }
    if (this.active) return { ok: false, error: 'busy' }
    const project = getProjectById(this.db, projectId)
    if (!project) return { ok: false, error: 'invalid-project' }
    if (project.source !== 'mostaql') return { ok: false, error: 'unsupported-source' }
    const ready = this.broker.preflight(projectId)
    if (!ready.ok) return ready
    const existing = getProposalDraft(this.db, projectId)
    if (!existing) {
      const error = this.ai.standingPreflight()
      if (error) return { ok: false, error: error as 'consent-required' | 'no-key' | 'bad-request' }
    }
    const operation = { operationId: randomUUID(), projectId, phase: existing ? 'opening' as const : 'writing' as const }
    if (!this.broker.reserve(operation.operationId)) return { ok: false, error: 'busy' }
    const destination = this.broker.status().selectedId
    this.active = operation
    this.changed()
    try {
      if (!existing) {
        const result = await this.ai.generateStanding(projectId, operation.operationId)
        if (this.active !== operation || !this.allowed()) return { ok: false, error: 'cancelled' }
        if (!result.ok) {
          const error = result.error
          return { ok: false, error: error === 'text-changed' ? error : AI_ERROR_CODES.includes(error as typeof AI_ERROR_CODES[number]) ? error as typeof AI_ERROR_CODES[number] : 'generation-failed' }
        }
        if (!this.ai.standingAllowed()) return { ok: false, error: 'consent-required' }
      }
      if (this.active !== operation || !this.allowed()) return { ok: false, error: 'cancelled' }
      const current = getProjectById(this.db, projectId)
      if (this.broker.status().selectedId !== destination || current?.source !== project.source || current?.url !== project.url || current?.externalId !== project.externalId) return { ok: false, error: 'invalid-project' }
      operation.phase = 'opening'
      this.changed()
      const result = await this.broker.quick(projectId, 'draft', undefined, operation.operationId)
      return this.active === operation && this.allowed() ? result : { ok: false, error: 'cancelled' }
    } finally {
      this.broker.release(operation.operationId)
      if (this.active === operation) {
        // Launch completion is not job completion: Chrome may connect later.
        this.pendingOwner = this.broker.ownsJob(operation.operationId) ? operation.operationId : null
        this.active = null
      }
      this.changed()
    }
  }
}
