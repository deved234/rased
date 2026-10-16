import type { Db } from '../storage/db.js'
import { getProjectById } from '../storage/repositories.js'
import { factsNeedFetch, markFacts, saveFetchedFacts } from '../storage/projectFacts.js'
import { fetchDetail, type DetailFetchResult } from '../collector/enrichment.js'
import { parseProjectFacts } from '../collector/projectFacts.js'
import { DetailBudget } from '../collector/detailBudget.js'

/** Nafezly metadata only: RSS remains the description source and polling keeps priority. */
export class ProjectFactsFetcher {
  private queue: number[] = []
  private active: number | null = null
  private abort: AbortController | null = null
  private work: Promise<void> | null = null
  private closed = false
  private budget = new DetailBudget(5000)
  constructor(private deps: { db: () => Db | null; gateOpen: () => boolean; settled: (id: number) => void; failure: (result: DetailFetchResult) => void; fetchImpl?: typeof fetch; now?: () => number }) {}
  private now(): number { return this.deps.now?.() ?? Date.now() }
  isPending(id: number): boolean { return this.active === id || this.queue.includes(id) }
  request(id: number, force = false): void {
    const db = this.deps.db()
    if (this.closed || !db || getProjectById(db, id)?.source !== 'nafezly' || this.isPending(id) || !factsNeedFetch(db, id, this.now(), force)) return
    if (this.queue.length < 30) this.queue.push(id)
  }
  abortActive(): void { this.abort?.abort() }
  drop(id: number): void { this.queue = this.queue.filter(value => value !== id); if (this.active === id) this.abortActive() }
  async close(): Promise<void> { this.closed = true; this.queue = []; this.abortActive(); await this.work }
  pump(): Promise<void> {
    if (this.work) return this.work
    const db = this.deps.db()
    if (this.closed || !db || !this.queue.length || !this.deps.gateOpen() || !this.budget.claim(this.now())) return Promise.resolve()
    const id = this.queue.shift()!, p = getProjectById(db, id)
    if (!p) { this.budget.release(); return Promise.resolve() }
    const controller = new AbortController()
    this.active = id; this.abort = controller
    this.work = Promise.resolve().then(async () => {
      try {
        markFacts(db, id, 'loading', null, new Date(this.now()).toISOString())
        const result = await fetchDetail(p.url, { source: 'nafezly', signal: controller.signal, fetchImpl: this.deps.fetchImpl })
        if (controller.signal.aborted || this.closed || this.deps.db() !== db || !db.isOpen || !getProjectById(db, id)) {
          if (db.isOpen && getProjectById(db, id)) markFacts(db, id, 'not_requested')
          return
        }
        const data = result.ok && result.html ? parseProjectFacts(result.html, 'nafezly') : null
        if (data) saveFetchedFacts(db, id, data, new Date(this.now()).toISOString())
        else {
          markFacts(db, id, 'failed', result.ok ? 'metadata-unavailable' : result.kind === 'http' ? `http-${result.status}` : result.kind ?? 'invalid_content', new Date(this.now()).toISOString())
          if (!result.ok) this.deps.failure(result)
        }
      } catch {
        if (db.isOpen && getProjectById(db, id)) markFacts(db, id, controller.signal.aborted ? 'not_requested' : 'failed', controller.signal.aborted ? null : 'metadata-failed')
      } finally {
        this.active = null; this.abort = null; this.work = null; this.budget.release(); this.deps.settled(id)
      }
    })
    return this.work
  }
}
