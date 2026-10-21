import type { Db } from '../storage/db.js'
import type { AppSettings, ProjectDetails, SourceHealth } from '../shared/types.js'
import { getProjectById, getProjectDetailsRow, getSettingRaw, getSourceState, recordDiagnostic, runInTransaction, saveSourceState, upsertProjectDetails } from '../storage/repositories.js'
import { updateKafDetailsMetadata } from '../storage/kaf.js'
import { fetchKafHtml, fetchKafPage, KafFetchError, type KafItem } from '../collector/kaf.js'
import { parseKafDetails } from '../collector/kafDetails.js'
import { applyKafCycle, type KafCheckpoint } from '../collector/kafCycle.js'
import { initialSchedulerState, noteFailure } from '../collector/scheduler.js'
import { monitoringState } from '../shared/monitoring.js'
import { monitoringFields } from '../storage/monitoring.js'
import { markFacts, saveFetchedFacts } from '../storage/projectFacts.js'

interface Deps {
  db: () => Db | null
  settings: () => AppSettings
  accessAllowed?: () => boolean
  health: (health: SourceHealth) => void
  projects: (newIds: number[], changedIds: number[]) => void
  details: (id: number) => void
  flush: () => Promise<void>
  fetchImpl?: typeof fetch
  now?: () => number
  random?: () => number
  runId: string
}
export class KafController {
  private paused = false
  private sleeping = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private abort: AbortController | null = null
  private detailAbort: AbortController | null = null
  private work: Promise<void> | null = null
  private detailWork: Promise<void> | null = null
  private detailId: number | null = null
  private memoryBackoff = 0
  private queue: number[] = []
  private next: number | null = null
  private started = 0
  private finished = 0
  private detailFinished = 0
  private duration: number | null = null
  private count: number | null = null
  constructor(private readonly deps: Deps) {}
  private now(): number { return this.deps.now?.() ?? Date.now() }
  private available(): boolean { return (this.deps.accessAllowed?.() ?? true) && !this.closed && !this.sleeping && !this.paused && this.deps.settings().kafEnabled && !!this.deps.db() }
  private cooldown(): number { const db = this.deps.db(); return Math.max(this.memoryBackoff, db ? Date.parse(getSourceState(db, 'kaf').backoffUntil ?? '') || 0 : 0) }
  health(): SourceHealth {
    const db = this.deps.db(), s = db ? getSourceState(db, 'kaf') : null, backoff = this.cooldown()
    const enabled = this.deps.settings().kafEnabled, paused = this.paused && enabled
    return { state: monitoringState({ enabled, paused, backoffUntil: backoff, lastError: s?.lastError ?? null, lastSuccessAt: s?.lastSuccessAt ?? null, failures: s?.consecutiveFailures ?? 0 }, this.now()), enabled, checking: !!this.work && this.available(), ...monitoringFields(db, 'kaf'),
      paused, lastAttemptAt: s?.lastAttemptAt ?? null, lastSuccessAt: s?.lastSuccessAt ?? null, lastError: s?.lastError ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0, nextAttemptAt: this.next ? new Date(this.next).toISOString() : null, lastDurationMs: this.duration, lastItemCount: this.count, effectiveIntervalMs: backoff > this.now() ? backoff - this.now() : 5500 }
  }
  private emit(): void { this.deps.health(this.health()) }
  start(paused = false): void { this.paused = paused; this.schedule(0) }
  setPaused(paused: boolean): SourceHealth { this.paused = paused; if (paused) this.cancel(); else this.schedule(0); this.emit(); return this.health() }
  settingsChanged(): void { if (!this.available()) this.cancel(); else if (!this.timer && !this.work) this.schedule(); this.emit() }
  sleep(): void { this.sleeping = true; this.cancel() }
  wake(): void { this.sleeping = false; this.schedule(2000) }
  private cancel(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.next = null; this.abort?.abort(); this.detailAbort?.abort(); this.queue = [] }
  async close(): Promise<void> { this.closed = true; this.cancel(); await Promise.allSettled([this.work, this.detailWork].filter(Boolean) as Promise<void>[]) }
  private schedule(delay?: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.next = null
    if (!this.available() || this.work) { this.emit(); return }
    const interval = 5000 + (this.deps.random?.() ?? Math.random()) * 1000
    const when = Math.max(this.cooldown(), this.finished ? this.finished + 1000 : 0, this.started ? this.started + interval : 0, delay === undefined ? 0 : this.now() + delay)
    this.next = Math.max(this.now(), when)
    this.timer = setTimeout(() => { this.timer = null; void this.poll() }, this.next - this.now())
    this.emit()
  }
  poll(): Promise<void> {
    if (!this.available() || this.cooldown() > this.now() || this.work) return this.work ?? Promise.resolve()
    if (this.finished && this.now() < this.finished + 1000) { this.schedule(); return Promise.resolve() }
    this.started = this.now(); this.abort = new AbortController(); this.next = null
    const signal = this.abort.signal
    this.work = this.run(signal).catch(error => { if (!signal.aborted && this.available()) this.fail(error) }).finally(() => {
      this.finished = this.now(); this.work = null; this.abort = null; this.schedule(); void this.pumpDetails()
    })
    this.emit(); return this.work
  }
  private fail(error: unknown): void {
    const db = this.deps.db(); if (!db || this.closed) return
    const e = error instanceof KafFetchError ? error : new KafFetchError('invalid_content')
    const previous = getSourceState(db, 'kaf')
    const failure = noteFailure({ ...initialSchedulerState(), consecutiveFailures: previous.consecutiveFailures, backoffUntilMs: this.cooldown() }, { kind: e.kind, retryAfterMs: e.retryAfterMs, nowMs: this.now(), random: this.deps.random })
    this.memoryBackoff = failure.backoffUntilMs ?? this.now() + 30000
    try {
      saveSourceState(db, { ...previous, lastAttemptAt: new Date(this.now()).toISOString(), lastError: e.message, consecutiveFailures: failure.consecutiveFailures, backoffUntil: new Date(this.memoryBackoff).toISOString(), transportKind: 'html-fragment', runId: this.deps.runId })
      this.duration = this.now() - this.started
      recordDiagnostic(db, { at: new Date(this.now()).toISOString(), endpointKind: 'kaf', status: 'failed', durationMs: this.duration, itemCount: null, errorCategory: e.kind, detail: e.message })
    } catch { /* Keep an in-memory cooldown if persistence itself failed. */ }
  }
  private async run(signal: AbortSignal): Promise<void> {
    const db = this.deps.db()!
    const previous = getSourceState(db, 'kaf')
    saveSourceState(db, { ...previous, lastAttemptAt: new Date(this.started).toISOString() })
    const json = (key: string): unknown => { try { return JSON.parse(getSettingRaw(db, key) ?? 'null') } catch { return null } }
    const oldIds = json('kaf:last-list-ids'), stored = json('kaf:checkpoint') as KafCheckpoint | null
    const anchorIds = stored && Array.isArray(stored.anchorIds) ? stored.anchorIds : Array.isArray(oldIds) ? oldIds.filter((x): x is string => typeof x === 'string') : []
    const cursor = stored && Number.isInteger(stored.cursor) && stored.cursor >= 2 && stored.cursor <= 997 ? stored.cursor : 2
    const head = await fetchKafPage(1, signal, this.deps.fetchImpl)
    const items: KafItem[] = [...head.items], ids = head.items.map(item => item.externalId)
    let found = !stored && ids.some(id => anchorIds.includes(id)), nextPage = cursor, hasNext = head.hasNext
    if (!previous.baselineComplete || stored || !found && hasNext) {
      for (let n = 0; n < 2 && hasNext && (!found || !previous.baselineComplete); n++) {
        const result = await fetchKafPage(nextPage, signal, this.deps.fetchImpl)
        items.push(...result.items); found ||= result.items.some(item => anchorIds.includes(item.externalId)); hasNext = result.hasNext; nextPage++
      }
    }
    if (signal.aborted || !this.available() || this.cooldown() > this.now() || this.deps.db() !== db) return
    const checkpoint = previous.baselineComplete && !found && hasNext ? { anchorIds, cursor: nextPage } : null
    const out = applyKafCycle(db, items, { nowMs: this.now(), durationMs: this.now() - this.started, runId: this.deps.runId, settings: this.deps.settings(), firstPageIds: ids, checkpoint, coverageComplete: found || !hasNext })
    this.duration = this.now() - this.started; this.count = items.length
    this.deps.projects(out.insertedIds, out.updatedIds)
    if (out.notifyIds.length) await this.deps.flush()
  }
  requestDetails(id: number, force: boolean): ProjectDetails | null {
    const db = this.deps.db(), p = db ? getProjectById(db, id) : null
    if (!db || !p || p.source !== 'kaf') return null
    const row = getProjectDetailsRow(db, id)
    if (!force && row.status === 'ready' && row.fetchedAt && this.now() - Date.parse(row.fetchedAt) < 86400000) return row
    if (!this.available() || this.cooldown() > this.now()) return row
    if (this.detailId !== id && !this.queue.includes(id)) this.queue.push(id)
    if (this.queue.length > 30) this.queue.pop()
    void this.pumpDetails()
    return row.text ? row : { ...row, status: 'loading' }
  }
  isDetailsPending(id: number): boolean { return this.detailId === id || this.queue.includes(id) }
  private pumpDetails(): Promise<void> {
    if (!this.available() || this.work || this.detailWork || !this.queue.length || this.cooldown() > this.now() || this.now() - this.detailFinished < 5000) return this.detailWork ?? Promise.resolve()
    const id = this.queue.shift()!, db = this.deps.db()!, p = getProjectById(db, id)
    if (!p || p.source !== 'kaf') return Promise.resolve()
    this.detailAbort = new AbortController(); const signal = this.detailAbort.signal
    const existing = getProjectDetailsRow(db, id)
    try { upsertProjectDetails(db, id, { ...existing, status: existing.text ? existing.status : 'loading' }) } catch (error) { this.fail(error); return Promise.resolve() }
    this.detailId = id
    this.detailWork = Promise.resolve().then(async () => {
      try {
        if (signal.aborted || !this.available()) return
        markFacts(db, id, 'loading')
        const html = await fetchKafHtml(p.url, signal, false, this.deps.fetchImpl), data = parseKafDetails(html)
        if (signal.aborted || !this.available() || this.deps.db() !== db) return
        runInTransaction(db, () => {
          updateKafDetailsMetadata(db, id, data)
          upsertProjectDetails(db, id, { text: data.text, provenance: data.truncated ? 'truncated' : 'full', fetchedAt: new Date(this.now()).toISOString(), status: 'ready', errorCode: null })
        })
        const current = getProjectById(db, id)!
        saveFetchedFacts(db, id, { budgetMin: data.budgetRaw ? data.budgetMin : current.budgetMin, budgetMax: data.budgetRaw ? data.budgetMax : current.budgetMax, budgetRaw: data.budgetRaw ?? current.budgetRaw, currency: data.budgetRaw ? data.budgetMin !== null ? 'USD' : null : current.currency, durationDays: data.durationDays, durationRaw: data.durationRaw })
        this.deps.projects([], [id])
      } catch (error) {
        if (signal.aborted || !this.available() || this.deps.db() !== db) return
        if (error instanceof KafFetchError && ['forbidden', 'rate_limited'].includes(error.kind)) { this.abort?.abort(); this.fail(error); this.schedule() }
        try { markFacts(db, id, 'failed', error instanceof KafFetchError ? error.kind : 'metadata-unavailable'); upsertProjectDetails(db, id, { ...existing, status: existing.text ? 'ready' : 'failed', errorCode: 'kaf-detail-failed' }) } catch (failure) { this.fail(failure) }
      } finally {
        if (signal.aborted && this.deps.db() === db && db.isOpen) {
          try { markFacts(db, id, 'not_requested'); upsertProjectDetails(db, id, { ...existing, status: existing.text ? 'ready' : 'not_requested', errorCode: 'interrupted' }) } catch { /* DB shutdown or failed persistence. */ }
        }
        this.detailFinished = this.now(); this.detailWork = null; this.detailAbort = null; this.detailId = null; this.deps.details(id)
      }
    })
    return this.detailWork
  }
}
