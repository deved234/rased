/**
 * Host-wide request arbiter for polling and HTML detail slot consumers.
 *
 * DetailBudget equivalence:
 * Provides identical grant/deny behavior for 'enrichment' and 'details' claims
 * with finite clocks, finite non-negative gaps, and correctly paired releases.
 * Stale releases intentionally differ (per Rule 7, releasing an old or preempted
 * claim never frees a newer holder's slot), and non-finite inputs are normalized.
 */

export type ArbiterPriority = 'poll' | 'enrichment' | 'details' | 'watch'
export const ARBITER_EXPECTED_INITIAL_MS = 1500
export const ARBITER_EXPECTED_MAX_MS = 10_000 // = DETAIL_TIMEOUT_MS
export const ARBITER_EXPECTED_WINDOW = 10
export const ARBITER_WATCH_MARGIN_MS = 500

export interface ArbiterClaim {
  readonly priority: ArbiterPriority
  readonly startedAt: number
  release(outcome?: { ok?: boolean; cancelled?: boolean }): void
}

export interface ArbiterSnapshot {
  detailHolder: ArbiterPriority | null
  pollActive: boolean
  waiting: ArbiterPriority[]
  nextPollDueAt: number | null
  expectedMs: number
  preemptions: number
}

interface InternalWatch {
  readonly onPreempt?: () => void
  preempted: boolean
  released: boolean
}

export class SourceArbiter {
  private readonly nowFn: () => number
  private readonly minGapMs: number
  private pollClaim: ArbiterClaim | null = null
  private detailClaim: ArbiterClaim | null = null
  private activeWatch: InternalWatch | null = null
  private lastDetailStart = -Infinity
  private nextPollDue: number | null = null
  private enrichmentWaiters = 0
  private detailsWaiters = 0
  private preemptionsCount = 0
  private readonly samples: number[] = []

  constructor(opts: { now: () => number; minGapMs: number }) {
    this.nowFn = opts.now
    this.minGapMs = typeof opts?.minGapMs === 'number' && Number.isFinite(opts.minGapMs)
      ? Math.max(0, opts.minGapMs)
      : 0
  }

  private now(): number {
    const t = this.nowFn()
    return Number.isFinite(t) ? t : 0
  }

  setNextPollDue(at: number | null): void {
    if (at === null || typeof at !== 'number' || !Number.isFinite(at)) {
      this.nextPollDue = null
    } else {
      this.nextPollDue = at
    }
  }

  want(priority: 'enrichment' | 'details'): void {
    if (priority === 'enrichment') {
      this.enrichmentWaiters++
    } else if (priority === 'details') {
      this.detailsWaiters++
    }
  }

  unwant(priority: 'enrichment' | 'details'): void {
    if (priority === 'enrichment') {
      if (this.enrichmentWaiters > 0) this.enrichmentWaiters--
    } else if (priority === 'details') {
      if (this.detailsWaiters > 0) this.detailsWaiters--
    }
  }

  expectedMs(): number {
    if (this.samples.length === 0) {
      return ARBITER_EXPECTED_INITIAL_MS
    }
    const sum = this.samples.reduce((acc, v) => acc + v, 0)
    return sum / this.samples.length
  }

  snapshot(): ArbiterSnapshot {
    const waiting: ArbiterPriority[] = []
    for (let i = 0; i < this.enrichmentWaiters; i++) {
      waiting.push('enrichment')
    }
    for (let i = 0; i < this.detailsWaiters; i++) {
      waiting.push('details')
    }
    return {
      detailHolder: this.detailClaim ? this.detailClaim.priority : null,
      pollActive: this.pollClaim !== null,
      waiting,
      nextPollDueAt: this.nextPollDue,
      expectedMs: this.expectedMs(),
      preemptions: this.preemptionsCount
    }
  }

  private recordSample(duration: number): void {
    const clamped = Math.min(Math.max(0, duration), ARBITER_EXPECTED_MAX_MS)
    this.samples.push(clamped)
    if (this.samples.length > ARBITER_EXPECTED_WINDOW) {
      this.samples.shift()
    }
  }

  claim(priority: ArbiterPriority, onPreempt?: () => void, atMs?: number): ArbiterClaim | null {
    const now = typeof atMs === 'number' && Number.isFinite(atMs) ? atMs : this.now()
    if (priority === 'poll') {
      if (this.pollClaim !== null) return null
      const watchToPreempt = this.activeWatch
      if (watchToPreempt !== null) {
        watchToPreempt.preempted = true
        watchToPreempt.released = true
        this.activeWatch = null
        this.detailClaim = null
        this.preemptionsCount++
      }
      let released = false
      const claim: ArbiterClaim = {
        priority: 'poll',
        startedAt: now,
        release: () => {
          if (released) return
          released = true
          if (this.pollClaim === claim) {
            this.pollClaim = null
          }
        }
      }
      this.pollClaim = claim
      if (watchToPreempt?.onPreempt) {
        try {
          watchToPreempt.onPreempt()
        } catch {
          // Callback exceptions must not break the arbiter
        }
      }
      return claim
    }

    if (priority === 'enrichment' || priority === 'details') {
      if (this.detailClaim !== null && this.activeWatch === null) {
        return null
      }
      if (now - this.lastDetailStart < this.minGapMs) {
        return null
      }

      const watchToPreempt = this.activeWatch
      if (watchToPreempt !== null) {
        watchToPreempt.preempted = true
        watchToPreempt.released = true
        this.activeWatch = null
        this.preemptionsCount++
      }

      this.lastDetailStart = now
      const clockStart = this.now()
      let released = false
      const claim: ArbiterClaim = {
        priority,
        startedAt: now,
        release: (outcome) => {
          if (released) return
          released = true
          if (this.detailClaim === claim) {
            this.detailClaim = null
          }
          if (outcome?.ok === true && !outcome?.cancelled) {
            this.recordSample(this.now() - clockStart)
          }
        }
      }
      this.detailClaim = claim

      if (watchToPreempt?.onPreempt) {
        try {
          watchToPreempt.onPreempt()
        } catch {
          // Callback exceptions must not break the arbiter
        }
      }
      return claim
    }

    if (priority === 'watch') {
      if (this.pollClaim !== null) return null
      if (this.detailClaim !== null) return null
      if (this.enrichmentWaiters > 0 || this.detailsWaiters > 0) return null

      if (now - this.lastDetailStart < this.minGapMs) return null

      if (this.nextPollDue !== null) {
        if (this.nextPollDue <= now || this.nextPollDue - now < this.expectedMs() + ARBITER_WATCH_MARGIN_MS) {
          return null
        }
      }

      this.lastDetailStart = now
      const clockStart = this.now()
      const internalWatch: InternalWatch = {
        onPreempt,
        preempted: false,
        released: false
      }
      this.activeWatch = internalWatch
      const claim: ArbiterClaim = {
        priority: 'watch',
        startedAt: now,
        release: (outcome) => {
          if (internalWatch.released) return
          internalWatch.released = true
          if (this.activeWatch === internalWatch) {
            this.activeWatch = null
          }
          if (this.detailClaim === claim) {
            this.detailClaim = null
          }
          if (!internalWatch.preempted && outcome?.ok === true && !outcome?.cancelled) {
            this.recordSample(this.now() - clockStart)
          }
        }
      }
      this.detailClaim = claim
      return claim
    }

    return null
  }
}
