import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { ConsentStore } from './consent.js'
import type { TelemetryConfig } from './config.js'
import type { TelemetryMessage, TelemetryWorkerData } from './protocol.js'
import { TELEMETRY_DISCLOSURE, validTelemetryProperties, type AnalyticsStatus, type TelemetryEvents, type TelemetryName } from '../../shared/telemetry.js'
import type { SourceHealth } from '../../shared/types.js'
import type { SourceId } from '../../shared/sources.js'

export class TelemetryService {
  private consent: ConsentStore
  private worker: Worker | null = null
  private blocked = false
  private closed = false
  private request = 0
  private waiting = new Map<number, (failed?: boolean) => void>()
  private restarting = false
  private recoveringPurge = false
  private startedRecorded = false
  private notificationBoot = false
  private healthEpoch = Date.now()
  private changes: Promise<void> = Promise.resolve()
  private restartCount = 0
  private healthSeen = new Map<SourceId, { attempt: string | null; state: string }>()
  private summary: Pick<AnalyticsStatus, 'queued' | 'dropped' | 'transport' | 'lastAcceptedAt'> = { queued: 0, dropped: 0, transport: 'unavailable', lastAcceptedAt: null }
  constructor(private options: { root: string; entry: string; version: string; language: 'ar' | 'en'; windowsFamily: '10' | '11' | 'other'; config: TelemetryConfig | null; fixture?: boolean; changed: () => void }) {
    this.consent = new ConsentStore(options.root)
  }
  start(notificationBoot: boolean): void {
    this.notificationBoot ||= notificationBoot
    if (this.worker || this.closed) return
    if (this.consent.snapshot().purgePending) {
      if (!this.recoveringPurge) {
        this.recoveringPurge = true
        void this.change('forget').catch(() => {}).finally(() => { this.recoveringPurge = false })
      }
      return
    }
    const data: TelemetryWorkerData = { directory: this.consent.directory, consent: this.consent.snapshot(), config: this.options.config, fixture: this.options.fixture === true, context: { appVersion: this.options.version, language: this.options.language, windowsFamily: this.options.windowsFamily, environment: this.options.fixture ? 'qa' : this.options.config?.environment ?? 'production' } }
    try {
      const worker = new Worker(this.options.entry, { workerData: data })
      this.worker = worker
      worker.on('message', (value: { type?: string; request?: number; failed?: boolean; queued?: number; dropped?: number; transport?: AnalyticsStatus['transport']; lastAcceptedAt?: string | null }) => {
        if (this.worker !== worker) return
        if (value.type === 'status') {
          this.summary = { queued: value.queued ?? 0, dropped: value.dropped ?? 0, transport: value.transport ?? 'unavailable', lastAcceptedAt: value.lastAcceptedAt ?? null }
          if (value.request) { this.waiting.get(value.request)?.(value.failed); this.waiting.delete(value.request) }
          this.options.changed()
        }
      })
      const failed = (): void => {
        if (this.worker !== worker) return
        this.worker = null; this.summary.transport = 'unavailable'; this.options.changed()
        for (const done of this.waiting.values()) done(true)
        this.waiting.clear()
        // Recovery is bounded and never restarts a revoked or closing sender.
        if (!this.closed && !this.blocked && !this.restarting && this.restartCount < 2) {
          this.restarting = true; this.restartCount++
          setTimeout(() => { this.restarting = false; if (!this.closed && !this.blocked) this.start(notificationBoot) }, 2000 * this.restartCount).unref()
        }
      }
      worker.on('error', failed)
      worker.on('exit', failed)
      if (!this.startedRecorded && this.allowed()) { this.record('started', { launch_kind: notificationBoot ? 'notification' : 'normal' }); this.startedRecorded = true }
    } catch { this.summary.transport = 'unavailable' }
  }
  private available(): boolean { return !!this.options.config || this.options.fixture === true }
  private allowed(): boolean { return !this.closed && !this.blocked && this.available() && !!this.worker && this.consent.snapshot().state === 'enabled' && !this.consent.snapshot().purgePending }
  status(): AnalyticsStatus {
    const c = this.consent.snapshot()
    return { accessAllowed: !this.available() || (!this.closed && !this.blocked && c.state === 'enabled' && !c.purgePending), available: this.available(), state: c.state, disclosure: TELEMETRY_DISCLOSURE, prompted: c.prompted, reference: c.identity, purgePending: c.purgePending === true, ...this.summary }
  }
  private post(message: TelemetryMessage): void {
    try { this.worker?.postMessage(message) } catch { this.summary.transport = 'unavailable' }
  }
  private async acknowledged(message: TelemetryMessage): Promise<void> {
    const request = ++this.request
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.waiting.delete(request); reject(Error('analytics-unavailable')) }, 1000)
      this.waiting.set(request, failed => { clearTimeout(timeout); if (failed) reject(Error('analytics-unavailable')); else resolve() })
      this.post({ ...message, request } as TelemetryMessage)
    })
  }
  change(action: 'enable' | 'disable' | 'later' | 'forget'): Promise<void> {
    const job = this.changes.then(() => this.applyChange(action))
    this.changes = job.catch(() => {})
    return job
  }
  private async purgeWorker(): Promise<void> {
    const old = this.worker
    this.worker = null
    // Never open a second SQLite connection until the previous worker exits.
    await old?.terminate()
    const data: TelemetryWorkerData = { directory: this.consent.directory, consent: this.consent.snapshot(), config: null, purgeOnly: true, fixture: this.options.fixture, context: { appVersion: this.options.version, environment: 'qa', language: this.options.language, windowsFamily: this.options.windowsFamily } }
    const worker = new Worker(this.options.entry, { workerData: data })
    let done = false
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('forget-incomplete')), 30000)
        // Cold worker imports and SQLite opening can exceed one second on
        // Windows. Keep the overall 30s bound, with a bounded startup budget.
        const ackTimer = setTimeout(() => reject(Error('forget-incomplete')), 5000)
        worker.on('message', value => {
          if (value.type === 'ack') clearTimeout(ackTimer)
          if (value.type === 'purged') done = true
        })
        worker.once('error', () => { clearTimeout(timer); clearTimeout(ackTimer); reject(Error('forget-incomplete')) })
        worker.once('exit', code => { clearTimeout(timer); clearTimeout(ackTimer); if (done && code === 0) resolve(); else reject(Error('forget-incomplete')) })
      })
    } finally { await worker.terminate() }
  }
  private async applyChange(action: 'enable' | 'disable' | 'later' | 'forget'): Promise<void> {
    if (action === 'enable' && !this.available()) throw Error('analytics-unavailable')
    // Gate before persistence/await so no fresh event crosses a revoke click.
    this.blocked = true
    this.options.changed()
    let next
    try { next = this.consent.change(action) }
    catch {
      // A failed withdrawal must stay closed even if Windows later resumes.
      // Suspending alone is insufficient: resume would revive old consent.
      const failed = this.worker
      this.worker = null
      this.summary.transport = 'unavailable'
      await failed?.terminate()
      this.options.changed()
      throw Error('analytics-write-failed')
    }
    // Publish the persisted withdrawal/purge marker before any worker await.
    this.options.changed()
    if (action === 'forget') {
      try {
        await this.purgeWorker()
        this.consent.completePurge()
        this.summary = { queued: 0, dropped: 0, transport: this.available() ? 'idle' : 'unavailable', lastAcceptedAt: null }
      } catch { this.summary.transport = 'unavailable'; this.options.changed(); throw Error('forget-incomplete') }
      this.blocked = false
      if (!this.closed) this.start(false)
      this.options.changed()
      return
    }
    if (this.worker) {
      try { await this.acknowledged({ type: 'consent', consent: next, request: 0 }) }
      catch { const failed = this.worker; this.worker = null; await failed?.terminate(); this.summary.transport = 'unavailable' }
    }
    this.blocked = false
    if (!this.worker && !this.closed) this.start(false)
    if (action === 'enable') {
      if (!this.startedRecorded) { this.record('started', { launch_kind: this.notificationBoot ? 'notification' : 'normal' }); this.startedRecorded = true }
      this.activity('interface')
    }
    if (action === 'disable') this.summary.queued = 0
    this.options.changed()
  }
  record<N extends TelemetryName>(name: N, properties: TelemetryEvents[N], once?: string): void {
    if (!this.allowed() || !validTelemetryProperties(name, properties)) return
    this.post({ type: 'record', generation: this.consent.snapshot().generation, name, properties, once })
  }
  activity(kind: 'interface' | 'monitoring'): void {
    this.record('active_daily', { activity_kind: kind }, `active:${new Date().toISOString().slice(0, 10)}:${kind}`)
  }
  counter(name: 'monitoring_hourly' | 'notification_summary', field: string): void {
    if (!this.allowed() || !validTelemetryProperties(name, { [field]: 1 })) return
    this.post({ type: 'counter', generation: this.consent.snapshot().generation, name, field })
  }
  health(source: SourceId, h: SourceHealth): void {
    const previous = this.healthSeen.get(source)
    if (h.checking) return
    this.healthSeen.set(source, { attempt: h.lastAttemptAt, state: h.state })
    if (!previous && (!h.lastAttemptAt || Date.parse(h.lastAttemptAt) < this.healthEpoch)) return
    if (previous?.state !== h.state) {
      const state = h.state === 'paused' ? 'paused' : h.state === 'disabled' ? 'disabled' : ['backing-off', 'needs-review'].includes(h.state) ? 'cooldown' : null
      if (state) this.counter('monitoring_hourly', `${source}_${state}`)
    }
    if (!h.lastAttemptAt || h.lastAttemptAt === previous?.attempt || h.enabled === false || h.paused) return
    if (!h.lastError && h.lastSuccessAt && Date.parse(h.lastSuccessAt) >= Date.parse(h.lastAttemptAt)) { this.counter('monitoring_hourly', `${source}_success`); this.activity('monitoring') }
    else if (h.lastError) this.counter('monitoring_hourly', `${source}_failure`)
  }
  language(language: 'ar' | 'en'): void { this.options.language = language; this.post({ type: 'context', language }) }
  suspend(): void { this.post({ type: 'suspend' }) }
  resume(): void { this.post({ type: 'resume' }) }
  async reset(): Promise<void> {
    try { if (this.worker) await this.acknowledged({ type: 'reset', request: 0 }) }
    catch { this.blocked = true; const failed = this.worker; this.worker = null; await failed?.terminate(); this.summary.transport = 'unavailable' }
    this.healthSeen.clear()
    this.healthEpoch = Date.now()
  }
  async flushFixture(): Promise<void> { if (this.options.fixture && this.worker) await this.acknowledged({ type: 'flush', request: 0 }) }
  async close(): Promise<void> {
    this.closed = true
    const worker = this.worker
    if (!worker) return
    this.post({ type: 'close' })
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { void worker.terminate(); resolve() }, 500)
      worker.once('exit', () => { clearTimeout(timer); resolve() })
    })
    this.worker = null
  }
}

export const telemetryWorkerEntry = (mainDirectory: string): string => join(mainDirectory, 'telemetryWorker.js')
