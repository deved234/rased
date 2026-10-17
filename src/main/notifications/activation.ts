import { parseNotificationActivation, type NotificationScheme } from '../../shared/notificationActivation.js'
import type { NotificationDestination } from '../../storage/notificationActivations.js'

export type ActivationOutcome = 'opened' | 'failed' | 'duplicate' | 'invalid' | 'queued' | 'overflow' | 'closed'
export interface BrowserOpenResult {
  launch: 'accepted' | 'failed' | 'unknown'
  foreground: 'confirmed' | 'denied' | 'target-unknown' | 'not-attempted'
  reason?: string
  durationMs: number
}

/** Opening is independent of renderer and extension readiness. Never focuses RASED. */
export class NotificationActivationController {
  private ready = false
  private closed = false
  private pending = new Set<string>()
  private active = new Map<string, Promise<ActivationOutcome>>()
  constructor(private scheme: NotificationScheme, private ports: {
    claim: (token: string) => NotificationDestination | 'duplicate' | null
    open: (destination: NotificationDestination) => Promise<BrowserOpenResult>
    completed: (destination: NotificationDestination, result: BrowserOpenResult) => void
    invalid: () => void
  }) {}

  async activate(raw: string): Promise<ActivationOutcome> {
    if (this.closed) return 'closed'
    const token = parseNotificationActivation(raw, this.scheme)
    if (!token) return 'invalid'
    if (!this.ready) {
      if (this.pending.has(raw)) return 'duplicate'
      if (this.pending.size >= 10) return 'overflow'
      this.pending.add(raw)
      return 'queued'
    }
    const previous = this.active.get(token)
    if (previous) return 'duplicate'
    const work = this.dispatch(token)
    this.active.set(token, work)
    try { return await work } finally { this.active.delete(token) }
  }

  private async dispatch(token: string): Promise<ActivationOutcome> {
    try {
      const destination = this.ports.claim(token)
      if (destination === 'duplicate') return 'duplicate'
      if (!destination) { this.ports.invalid(); return 'invalid' }
      let result: BrowserOpenResult
      try { result = await this.ports.open(destination) }
      catch { result = { launch: 'unknown', foreground: 'not-attempted', reason: 'launcher-exception', durationMs: 0 } }
      if (!this.closed) this.ports.completed(destination, result)
      return result.launch === 'accepted' ? 'opened' : 'failed'
    } catch { return 'failed' }
  }

  async start(): Promise<void> {
    if (this.closed) return
    this.ready = true
    const pending = [...this.pending]
    this.pending.clear()
    // Retain ordering without waiting for unrelated renderer or collector work.
    for (const raw of pending) await this.activate(raw)
  }

  close(): void { this.closed = true; this.pending.clear() }
}
