import { utilityProcess, type UtilityProcess } from 'electron'

/** Isolate Unicode indexing as well as reading from the collector main loop. */
export class SearchCacheBuilder {
  private child?: UtilityProcess
  private exited?: Promise<void>
  private stopped = false
  private suspended = false
  private attempts = 0
  private restart?: ReturnType<typeof setTimeout>
  constructor(private path: string, private entry: string, private pending: () => boolean) {}
  start(): void {
    if (this.stopped || this.child || this.attempts >= 3) return
    let child: UtilityProcess
    try { child = this.child = utilityProcess.fork(this.entry, [], { stdio: 'ignore', serviceName: 'RASED Search Index' }) }
    catch { if (++this.attempts < 3) this.restart = setTimeout(() => this.start(), 1000); return }
    let idle = false
    this.exited = new Promise(resolve => child.once('exit', () => resolve()))
    child.on('message', message => { if (message.idle && child === this.child) { idle = true; child.postMessage({ close: true }) } })
    child.once('exit', () => {
      if (this.child === child) this.child = undefined
      if (idle) { this.attempts = 0; if (!this.stopped && this.pending()) this.start(); return }
      if (!this.stopped && ++this.attempts < 3) this.restart = setTimeout(() => this.start(), 1000)
    })
    child.postMessage({ path: this.path, suspended: this.suspended })
  }
  suspend(on: boolean): void { this.suspended = on; this.child?.postMessage({ suspended: on }) }
  async close(): Promise<void> {
    this.stopped = true; clearTimeout(this.restart)
    const child = this.child, exited = this.exited
    if (!child || !exited) return
    child.postMessage({ close: true })
    const kill = setTimeout(() => child.kill(), 250)
    let deadline: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([exited, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('search-index-stop-failed')), 2000) })]) }
    finally { clearTimeout(kill); clearTimeout(deadline) }
  }
}
