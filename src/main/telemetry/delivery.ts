import { createHash } from 'node:crypto'
import type { TelemetryStore } from '../../storage/telemetryStore.js'
import { telemetryUuid, type AnalyticsStatus, type TelemetryEnvelope } from '../../shared/telemetry.js'
import type { SendResult } from './transports/posthog.js'

const DAY = 86400000
/** Durable transport state. Authentication never resets a provider cooldown. */
export class TelemetryDelivery {
  state: AnalyticsStatus['transport'] = 'idle'
  lastAccepted: string | null
  private work: string[][] = []
  constructor(private store: TelemetryStore, destination: unknown, private version: string, private now = Date.now) {
    this.lastAccepted = store.get('last-accepted')
    const fingerprint = createHash('sha256').update(JSON.stringify(destination)).digest('hex')
    if (store.get('transport-config') !== fingerprint) {
      for (const key of ['retry-at', 'failures', 'auth-next-check', 'auth-attempts', 'auth-rejected-at']) store.set(key, '0')
      store.set('transport-config', fingerprint)
    }
    // Old persistent rejection was too broad (e.g. 400). Re-evaluate once using
    // the new classification, while retaining the independent retry deadline.
    store.set('rejected', 'false')
    try {
      const tasks: unknown = JSON.parse(store.get('isolation-work') ?? '[]')
      if (Array.isArray(tasks) && tasks.length <= 1000 && tasks.every(t => Array.isArray(t) && t.length <= 50 && t.every(telemetryUuid))) this.work = tasks
    } catch { /* Discard metadata only; queued events remain authoritative. */ }
    if (this.number('auth-rejected-at')) this.state = 'rejected'
    else if (this.number('retry-at') > now()) this.state = 'retrying'
  }
  private number(key: string): number { const n = Number(this.store.get(key)); return Number.isFinite(n) && n >= 0 ? n : 0 }
  private persist(): void { this.store.set('isolation-work', JSON.stringify(this.work)) }
  private retry(delay = 0, increment = true): void {
    const failures = Math.min(20, this.number('failures') + (increment ? 1 : 0))
    this.store.set('failures', String(failures))
    this.store.set('retry-at', String(Math.max(this.number('retry-at'), this.now() + Math.max(delay, Math.min(3600000, 30000 * 2 ** Math.min(Math.max(0, failures - 1), 7))))))
    this.state = 'retrying'
  }
  resume(): void { this.store.set('retry-at', String(Math.max(this.number('retry-at'), this.now() + 15000))) }
  async cycle(send: (events: TelemetryEnvelope[]) => Promise<SendResult>, signal: AbortSignal): Promise<void> {
    if (this.now() < this.number('retry-at')) return
    const auth = this.number('auth-rejected-at') > 0
    if (auth && this.store.get('auth-version') === this.version && this.now() < this.number('auth-next-check')) { this.state = 'rejected'; return }
    const candidates: string[] = []
    let accepted = false, requests = 0, deferred = false, isolating = false
    const read = (ids: string[]): TelemetryEnvelope[] => this.store.read(ids)
    try {
      this.work = this.work.map(ids => read(ids).map(e => e.eventId)).filter(ids => ids.length > 0)
      if (!this.work.length) {
        const batch = this.store.batch(Math.max(4096, Math.min(61440, this.number('batch-bytes') || 61440)))
        if (!batch.length) return
        this.work.push(batch.map(e => e.eventId))
      }
      this.state = 'sending'
      while (this.work.length && requests < 12 && !signal.aborted) {
        const ids = this.work.shift()!, batch = read(ids)
        if (!batch.length) continue
        requests++
        // Keep the current task durable while HTTP is in flight.
        this.work.unshift(batch.map(e => e.eventId)); this.persist()
        const result = await send(batch)
        if (signal.aborted) return
        this.work.shift()
        if (result.kind === 'accepted') {
          this.store.acknowledge(batch.map(e => e.eventId)); accepted = true
          this.lastAccepted = new Date(this.now()).toISOString()
          this.store.set('last-accepted', this.lastAccepted)
          for (const key of ['auth-rejected-at','auth-next-check','auth-attempts','failures']) this.store.set(key, '0')
        } else if (result.kind === 'poison' || result.kind === 'too_large') {
          isolating = true
          if (result.kind === 'too_large') {
            const bytes = batch.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0)
            this.store.set('batch-bytes', String(Math.max(4096, Math.floor(bytes / 2))))
          }
          if (batch.length > 1) {
            const middle = Math.ceil(batch.length / 2)
            this.work.unshift(batch.slice(0, middle).map(e => e.eventId), batch.slice(middle).map(e => e.eventId))
          } else candidates.push(batch[0]!.eventId)
        } else {
          deferred = true
          this.store.set('transport-reason', result.kind)
          this.work.unshift(batch.map(e => e.eventId))
          if (result.kind === 'auth') {
            const attempts = Math.min(20, this.number('auth-attempts') + 1)
            this.store.set('auth-attempts', String(attempts)); this.store.set('auth-version', this.version)
            this.store.set('auth-rejected-at', String(this.now()))
            this.store.set('auth-next-check', String(this.now() + Math.max(result.retryAfterMs ?? 0, Math.min(7 * DAY, DAY * 2 ** Math.min(attempts - 1, 3)))))
            this.state = 'rejected'
          } else this.retry(Math.max(result.retryAfterMs ?? 0, result.kind === 'quota' ? 3600000 : 0), result.kind !== 'quota')
          break
        }
        this.persist()
        // A recheck of rejected credentials uses one request, never a split tree.
        if (auth) break
      }
      if (signal.aborted) return
      const dropped = accepted ? this.store.dropPoison(candidates, 20) : []
      const retained = candidates.filter(id => !dropped.includes(id))
      this.work.push(...retained.map(id => [id]))
      if (retained.length || this.work.length) {
        if (isolating && !deferred) this.store.set('transport-reason', accepted && retained.length ? 'poison-limit' : 'poison-suspect')
        if (isolating && !accepted) this.store.set('poison-suspect-cycles', String(this.number('poison-suspect-cycles') + 1))
        if (!deferred && this.state !== 'rejected') this.retry(0, !accepted)
      } else if (accepted) {
        this.store.set('retry-at', String(this.now() + 10000)); this.state = 'idle'
        this.store.set('transport-reason', '')
      }
    } catch {
      if (!signal.aborted) this.retry()
    } finally {
      // Local cancellation neither increments nor resets failure/cooldown state.
      if (signal.aborted && this.state === 'sending') this.state = 'idle'
      if (!signal.aborted) this.persist()
    }
  }
}
