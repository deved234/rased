import { utilityProcess, type UtilityProcess } from 'electron'
import type { FilterDefinition, PageResult, QueryWindow } from '../../shared/types.js'
import type { SearchRequest } from './protocol.js'

interface Job {
  owner: string
  request: SearchRequest
  resolve: (value: PageResult | number[]) => void
  reject: (error: Error) => void
  revision: number
}

/** One reader, bounded fair queue, no synchronous list scans in Electron main. */
export class SearchService {
  private child?: UtilityProcess
  private ready = false
  private closed = false
  private restarting = false
  private queue: Job[] = []
  private active?: Job
  private timer?: ReturnType<typeof setTimeout>
  private retry?: ReturnType<typeof setTimeout>
  private sequence = 0
  private revision = 0
  private crashes: number[] = []
  private exited?: Promise<void>
  constructor(private path: string, private entry: string, private cold: () => boolean) {}

  invalidate(): void { this.revision++ }
  page(owner: string, definition: FilterDefinition, limit: number, offset: number, window?: QueryWindow): Promise<PageResult> {
    return this.enqueue(owner, { id: ++this.sequence, definition, limit, offset, window }) as Promise<PageResult>
  }
  match(owner: string, definition: FilterDefinition, ids: number[]): Promise<number[]> {
    return this.enqueue(owner, { id: ++this.sequence, definition, limit: 0, offset: 0, ids }) as Promise<number[]>
  }
  private enqueue(owner: string, request: SearchRequest): Promise<PageResult | number[]> {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('search-closed')); return }
      const previous = this.queue.findIndex(job => job.owner === owner)
      if (previous >= 0) this.queue.splice(previous, 1)[0]!.reject(new Error('search-superseded'))
      if (this.queue.length >= 8) { reject(new Error('search-overloaded')); return }
      this.queue.push({ owner, request, resolve, reject, revision: this.revision })
      this.pump()
    })
  }
  private spawn(): void {
    const now = Date.now()
    this.crashes = this.crashes.filter(time => now - time < 60_000)
    if (this.crashes.length >= 3) { this.failQueue('search-unavailable'); return }
    let child: UtilityProcess
    try { child = this.child = utilityProcess.fork(this.entry, [], { stdio: 'ignore', serviceName: 'RASED Search', execArgv: ['--max-old-space-size=64'] }) }
    catch { this.failQueue('search-start-failed'); return }
    this.exited = new Promise(resolve => child.once('exit', () => resolve()))
    child.on('message', (message: { ready?: boolean; id?: number; error?: string; result?: PageResult | number[] }) => {
      if (child !== this.child || this.closed) return
      if (message.ready) { clearTimeout(this.timer); this.ready = true; this.pump(); return }
      const job = this.active
      if (!job || message.id !== job.request.id) return
      clearTimeout(this.timer)
      this.active = undefined
      if (message.error) job.reject(new Error(message.error))
      else if (job.revision !== this.revision) {
        // A trailing retry is scheduled even if no further mutation arrives.
        // A newer request from the same surface always wins its waiting slot.
        if (this.queue.some(next => next.owner === job.owner)) job.reject(new Error('search-superseded'))
        else if (this.queue.length >= 8) job.reject(new Error('search-overloaded'))
        else this.queue.push(job)
        this.retry = setTimeout(() => { this.retry = undefined; this.pump() }, 200)
      } else {
        const result = message.result!
        job.resolve(Array.isArray(result) ? result : { ...result, revision: job.revision })
      }
      this.pump()
    })
    child.once('exit', () => {
      if (child !== this.child) return
      this.child = undefined; this.ready = false
      clearTimeout(this.timer)
      if (this.closed || this.restarting) return
      this.crashes.push(Date.now())
      this.active?.reject(new Error('search-crashed')); this.active = undefined
      this.pump()
    })
    this.timer = setTimeout(() => {
      this.failQueue('search-start-failed')
      void this.timeout()
    }, 8000)
    child.postMessage({ path: this.path })
  }
  private pump(): void {
    if (this.closed || this.restarting || this.active || this.retry || !this.queue.length) return
    if (!this.child) { this.spawn(); return }
    if (!this.ready) return
    const job = this.active = this.queue.shift()!
    job.revision = this.revision
    this.timer = setTimeout(() => { void this.timeout() }, this.cold() ? 8000 : 2000)
    this.child.postMessage(job.request)
  }
  private async timeout(): Promise<void> {
    this.restarting = true
    this.active?.reject(new Error('search-timeout')); this.active = undefined
    try { await this.stop(); this.restarting = false; this.pump() }
    catch { this.closed = true; this.failQueue('search-stop-failed') }
  }
  private failQueue(code: string): void { for (const job of this.queue.splice(0)) job.reject(new Error(code)) }
  private async stop(): Promise<void> {
    const child = this.child, exited = this.exited
    if (!child || !exited) return
    child.kill()
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('search-stop-failed')), 2000) })]) }
    finally { clearTimeout(timer) }
    if (this.child === child) { this.child = undefined; this.ready = false }
  }
  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer); clearTimeout(this.retry)
    this.active?.reject(new Error('search-closed')); this.active = undefined
    this.failQueue('search-closed')
    await this.stop()
  }
}
