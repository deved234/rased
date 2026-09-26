// On-demand full-description fetch: cache-first, TTL 24h, deduped,
// abortable, RSS keeps priority. Electron-free (db + injected callbacks).

import type { Db } from '../storage/db.js'
import { getProjectById, getProjectDetailsRow, upsertProjectDetails } from '../storage/repositories.js'
import type { ProjectDetails } from '../shared/types.js'
import { fetchDetail, parseDetail, type EnrichmentData, type DetailFetchKind } from '../collector/enrichment.js'
import { DetailBudget } from '../collector/detailBudget.js'
import { parseProjectBody } from '../collector/projectBody.js'

export const DETAILS_TTL_MS = 24 * 60 * 60 * 1000

export interface DetailsFetcherDeps {
  budget?: DetailBudget
  onMetadata?: (projectId: number, data: EnrichmentData) => void
  fetchImpl?: typeof fetch
  nowMs?: () => number
  gateOpen?: () => boolean
  onTransportFailure?: (kind: DetailFetchKind | 'http5xx' | 'forbidden' | 'rate_limited', retryAfterMs: number | null) => void
  onSettled?: (projectId: number) => void
}

/** Crash recovery: rows stuck in loading become retryable, never eternal. */
export function resetStaleLoadingDetails(db: Db): number {
  const r = db.prepare("UPDATE project_details SET status = 'not_requested', error_code = 'interrupted' WHERE status = 'loading';").run()
  return Number(r.changes)
}

function transportErrorCode(kind: DetailFetchKind, status?: number | null): string {
  if (kind === 'timeout') return 'timeout'
  if (kind === 'network') return 'network'
  if (kind === 'too_large') return 'too_large'
  if (kind === 'http' && status === 429) return 'http-429'
  if (kind === 'http' && typeof status === 'number' && status >= 500) return `http-${status}`
  if (kind === 'http' && (status === 401 || status === 403)) return `http-${status}`
  if (kind === 'http') return `http-${status ?? 'x'}`
  return 'invalid_content'
}

export class DetailsFetcher {
  private queue: number[] = []
  private inflight = new Map<number, AbortController>()
  private urls = new Map<number, string>()
  private readonly deps: Required<Omit<DetailsFetcherDeps, 'onTransportFailure' | 'onSettled' | 'onMetadata'>> &
    Pick<DetailsFetcherDeps, 'onTransportFailure' | 'onSettled' | 'onMetadata'>

  constructor(
    private readonly dbOf: () => Db | null,
    deps: DetailsFetcherDeps = {}
  ) {
    this.deps = {
      budget: deps.budget ?? new DetailBudget(),
      onMetadata: deps.onMetadata,
      fetchImpl: deps.fetchImpl ?? fetch,
      nowMs: deps.nowMs ?? Date.now,
      gateOpen: deps.gateOpen ?? (() => true),
      onTransportFailure: deps.onTransportFailure,
      onSettled: deps.onSettled
    }
  }

  /** Current cached row; queues a fetch when empty/stale/forced. Never throws. */
  request(projectId: number, url: string, force: boolean): ProjectDetails {
    const db = this.dbOf()
    const empty: ProjectDetails = { projectId, text: null, provenance: null, fetchedAt: null, status: 'not_requested', errorCode: null }
    if (!db) return empty
    const row = getProjectDetailsRow(db, projectId)
    if (this.inflight.has(projectId)) return { ...row, status: 'loading' }
    const fresh =
      row.status === 'ready' &&
      row.text !== null &&
      row.fetchedAt !== null &&
      this.deps.nowMs() - Date.parse(row.fetchedAt) < DETAILS_TTL_MS
    if (row.status === 'ready' && row.text !== null && (force || !fresh)) {
      // force or stale: refresh in background, serve the cached text now
      this.enqueue(projectId, url)
      return row
    }
    if (fresh) return row
    if (row.status === 'ready' && row.text !== null) return row
    this.enqueue(projectId, url)
    return { ...row, status: row.status === 'ready' ? row.status : 'loading' }
  }

  private enqueue(projectId: number, url: string): void {
    this.urls.set(projectId, url)
    if (!this.queue.includes(projectId) && !this.inflight.has(projectId)) this.queue.push(projectId)
    if (this.queue.length > 30) this.queue.splice(0, this.queue.length - 30)
  }

  drop(projectId: number): void {
    this.queue = this.queue.filter((id) => id !== projectId)
    this.urls.delete(projectId)
    this.inflight.get(projectId)?.abort()
  }

  abortActive(): void {
    for (const c of this.inflight.values()) {
      try {
        c.abort()
      } catch {
        /* ignore */
      }
    }
  }

  get pending(): number {
    return this.queue.length + this.inflight.size
  }

  async pump(): Promise<boolean> {
    if (this.queue.length === 0) return false
    if (!this.deps.gateOpen()) return false
    const db = this.dbOf()
    if (!db || !db.isOpen) {
      this.queue = []
      return false
    }
    if (this.inflight.size > 0 || !this.deps.budget.claim(this.deps.nowMs())) return false
    const projectId = this.queue.shift()
    if (projectId === undefined || !getProjectById(db, projectId)) {
      this.deps.budget.release()
      if (projectId !== undefined) this.urls.delete(projectId)
      return false
    }
    const url = this.urls.get(projectId)
    if (!url) { this.deps.budget.release(); return false }
    const ctrl = new AbortController()
    this.inflight.set(projectId, ctrl)
    const current = getProjectDetailsRow(db, projectId)
    const prevStatus = current.status
    upsertProjectDetails(db, projectId, {
      text: current.text,
      provenance: current.provenance,
      fetchedAt: current.fetchedAt,
      status: 'loading',
      errorCode: null
    })
    try {
      const res = await fetchDetail(url, { fetchImpl: this.deps.fetchImpl, signal: ctrl.signal })
      if (!db.isOpen || !getProjectById(db, projectId)) return true
      if (ctrl.signal.aborted) {
        // Caller-cancelled (pause/quit/navigate): restore, never failed, no backoff.
        upsertProjectDetails(db, projectId, {
          text: current.text,
          provenance: current.provenance,
          fetchedAt: current.fetchedAt,
          status: prevStatus === 'loading' ? 'not_requested' : prevStatus,
          errorCode: prevStatus === 'loading' ? 'interrupted' : current.errorCode
        })
        return true
      }
      const nowIso = new Date(this.deps.nowMs()).toISOString()
      if (res.ok && res.html) {
        this.deps.onMetadata?.(projectId, parseDetail(res.html))
        const parsed = parseProjectBody(res.html)
        if (parsed.ok) {
          upsertProjectDetails(db, projectId, { text: parsed.text, provenance: parsed.truncated ? 'truncated' : 'full', fetchedAt: nowIso, status: 'ready', errorCode: null })
        } else {
          upsertProjectDetails(db, projectId, {
            text: current.text,
            provenance: current.provenance,
            fetchedAt: current.fetchedAt,
            status: 'failed',
            errorCode: parsed.error
          })
        }
      } else {
        if (res.kind === 'http' && typeof res.status === 'number') {
          if (res.status === 429) this.deps.onTransportFailure?.('rate_limited', res.retryAfterMs ?? null)
          else if (res.status >= 500) this.deps.onTransportFailure?.('http5xx', res.retryAfterMs ?? null)
          else if (res.status === 401 || res.status === 403) this.deps.onTransportFailure?.('forbidden', res.retryAfterMs ?? null)
        } else if (res.kind === 'timeout' || res.kind === 'network') {
          this.deps.onTransportFailure?.(res.kind, null)
        }
        upsertProjectDetails(db, projectId, {
          text: current.text,
          provenance: current.provenance,
          fetchedAt: current.fetchedAt,
          status: 'failed',
          errorCode: transportErrorCode(res.kind ?? 'invalid_content', res.status)
        })
      }
    } finally {
      this.deps.budget.release()
      this.inflight.delete(projectId)
      this.urls.delete(projectId)
      if (db.isOpen && getProjectById(db, projectId)) this.deps.onSettled?.(projectId)
    }
    return true
  }
}
