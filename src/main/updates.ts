import type { EventEmitter } from 'node:events'
import type { UpdateState } from '../shared/updates.js'
import type { MutationResult } from '../shared/types.js'

export interface UpdaterPort extends Pick<EventEmitter, 'on' | 'removeListener'> {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(silent: boolean, relaunch: boolean): void
}
function releaseInfo(raw: unknown): { version: string; notes: string } {
  const info = raw as { version?: unknown; releaseNotes?: unknown } | null
  if (!info || typeof info.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info.version)) throw Error('Invalid release metadata')
  const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => typeof n?.note === 'string' ? n.note : '').join('\n') : ''
  return { version: info.version, notes: notes.replace(/<[^>]*>/g, '').slice(0, 12000) }
}
export class UpdateController {
  private state: UpdateState
  private busy = false
  private disposed = false
  private readonly listeners: [string, (...args: unknown[]) => void][] = []
  constructor(private readonly port: UpdaterPort | null, currentVersion: string, private readonly emit: (state: UpdateState) => void, private readonly log: (error: unknown) => void = () => {}) {
    this.state = { phase: port ? 'idle' : 'disabled', currentVersion, version: null, notes: '', percent: 0, transferred: 0, total: 0, checkedAt: null, error: null }
    if (!port) return
    port.autoDownload = false; port.autoInstallOnAppQuit = false
    port.allowPrerelease = false; port.allowDowngrade = false
    this.listen('checking-for-update', () => this.patch({ phase: 'checking', error: null }))
    this.listen('update-available', raw => {
      try { this.patch({ ...releaseInfo(raw), phase: 'available', checkedAt: new Date().toISOString(), error: null }) }
      catch (error) { this.fail('check', error) }
    })
    this.listen('update-not-available', () => this.patch({ phase: 'idle', version: null, notes: '', percent: 0, checkedAt: new Date().toISOString(), error: null }))
    this.listen('download-progress', raw => {
      if (this.state.phase !== 'downloading') return
      const p = raw as { percent?: number; transferred?: number; total?: number }
      const finite = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0
      this.patch({ percent: Math.min(100, finite(p.percent)), transferred: finite(p.transferred), total: finite(p.total) })
    })
    this.listen('update-downloaded', raw => {
      try { this.patch({ ...releaseInfo(raw), phase: 'downloaded', percent: 100, error: null }) }
      catch (error) { this.fail('download', error) }
    })
    this.listen('error', error => this.fail(this.state.phase === 'installing' ? 'install' : this.state.phase === 'downloading' ? 'download' : 'check', error))
  }
  snapshot(): UpdateState { return { ...this.state } }
  private listen(event: string, fn: (...args: unknown[]) => void): void { this.listeners.push([event, fn]); this.port?.on(event, fn) }
  private patch(patch: Partial<UpdateState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }; this.emit(this.snapshot())
  }
  private fail(error: 'check' | 'download' | 'install', cause: unknown): void { if (!this.disposed) { this.log(cause); this.patch({ phase: 'error', error }) } }
  async check(): Promise<MutationResult> {
    if (!this.port) return { ok: false, error: 'disabled' }
    if (this.busy || ['downloading', 'downloaded', 'installing'].includes(this.state.phase)) return { ok: false, error: 'busy' }
    this.busy = true
    this.patch({ phase: 'checking', version: null, notes: '', percent: 0, error: null })
    try { await this.port.checkForUpdates(); return { ok: this.state.phase !== 'error' } }
    catch (error) { this.fail('check', error); return { ok: false, error: 'check' } }
    finally { this.busy = false }
  }
  async download(): Promise<MutationResult> {
    if (!this.port || this.busy || !this.state.version || !(this.state.phase === 'available' || this.state.phase === 'error' && this.state.error === 'download')) return { ok: false, error: 'not-available' }
    this.busy = true
    this.patch({ phase: 'downloading', percent: 0, transferred: 0, total: 0, error: null })
    try { await this.port.downloadUpdate(); return { ok: this.snapshot().phase === 'downloaded' } }
    catch (error) { this.fail('download', error); return { ok: false, error: 'download' } }
    finally { this.busy = false }
  }
  install(): MutationResult {
    if (!this.port || this.busy || this.state.phase !== 'downloaded') return { ok: false, error: 'not-downloaded' }
    this.patch({ phase: 'installing', error: null })
    try { this.port.quitAndInstall(true, true); return { ok: this.snapshot().phase === 'installing' } }
    catch (error) { this.fail('install', error); return { ok: false, error: 'install' } }
  }
  dispose(): void {
    this.disposed = true
    for (const [event, fn] of this.listeners) this.port?.removeListener(event, fn)
    // A request may still fail while Electron is quitting. Do not let a late
    // EventEmitter error become uncaught after the UI listeners are removed.
    this.port?.on('error', () => {})
  }
}
