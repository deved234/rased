// Poll scheduler: single-flight, interval + progressive backoff + Retry-After.
// Pure logic (injectable clock) so tests are deterministic with fake timers.

export type FailureKind = 'timeout' | 'http5xx' | 'network' | 'rate_limited' | 'forbidden' | 'invalid_content' | 'too_large'

/** Backoff ladder in ms; jitter applied on top. Retry-After always wins when longer. */
export const BACKOFF_LADDER_MS = [10_000, 20_000, 40_000, 60_000, 120_000, 300_000]
export const BACKOFF_CAP_MS = 300_000
/** 401/403/protection-challenge: slow re-check floor, never hammer. */
export const NEEDS_REVIEW_FLOOR_MS = 5 * 60_000
/** Gap after which found items are 'recovered' rather than 'live'. */
export const RECOVER_GAP_MS = 60_000
/** Minimum rest between cycle starts so a slow request never causes a burst. */
export const MIN_REST_MS = 1_000

export interface SchedulerState {
  consecutiveFailures: number
  backoffUntilMs: number | null
  needsReview: boolean
  paused: boolean
}

export function initialSchedulerState(): SchedulerState {
  return { consecutiveFailures: 0, backoffUntilMs: null, needsReview: false, paused: false }
}

export interface FailureInput {
  kind: FailureKind
  retryAfterMs: number | null
  nowMs: number
  /** () => [0,1) for jitter; injectable for deterministic tests */
  random?: () => number
}

export function noteSuccess(s: SchedulerState, nowMs = Date.now()): SchedulerState {
  // A successful RSS response must not cancel a cooldown imposed by a detail request.
  const active = s.backoffUntilMs !== null && s.backoffUntilMs > nowMs
  return { ...s, consecutiveFailures: active ? s.consecutiveFailures : 0, backoffUntilMs: active ? s.backoffUntilMs : null, needsReview: active ? s.needsReview : false }
}

export function noteFailure(s: SchedulerState, f: FailureInput): SchedulerState {
  const rnd = f.random ?? Math.random
  const jitter = 0.8 + rnd() * 0.4
  const ladderIdx = Math.min(s.consecutiveFailures, BACKOFF_LADDER_MS.length - 1)
  const ladderMs = (BACKOFF_LADDER_MS[ladderIdx] ?? BACKOFF_CAP_MS) * jitter
  let waitMs: number
  if (f.kind === 'forbidden') {
    waitMs = Math.max(NEEDS_REVIEW_FLOOR_MS, f.retryAfterMs ?? 0)
  } else if (f.kind === 'rate_limited') {
    waitMs = Math.max(ladderMs, f.retryAfterMs ?? 0)
  } else {
    waitMs = ladderMs
    if (f.retryAfterMs !== null && f.retryAfterMs > waitMs) waitMs = f.retryAfterMs
  }
  const capped = Math.min(waitMs, Math.max(BACKOFF_CAP_MS, f.retryAfterMs ?? 0))
  return {
    ...s,
    consecutiveFailures: s.consecutiveFailures + 1,
    backoffUntilMs: Math.max(s.backoffUntilMs ?? 0, f.nowMs + capped),
    needsReview: f.kind === 'forbidden' ? true : s.needsReview
  }
}

/** ms until the next cycle may start; 0 = start now. */
export function delayUntilNext(s: SchedulerState, baseIntervalMs: number, nowMs: number, lastStartMs: number | null, lastFinishMs: number | null = null): number {
  if (s.paused) return -1
  if (s.backoffUntilMs !== null && nowMs < s.backoffUntilMs) return s.backoffUntilMs - nowMs
  if (lastStartMs === null) return 0
  const earliest = Math.max(lastStartMs + baseIntervalMs, (lastFinishMs ?? lastStartMs) + MIN_REST_MS)
  return Math.max(0, earliest - nowMs)
}

export function isBackingOff(s: SchedulerState, nowMs: number): boolean {
  return s.backoffUntilMs !== null && nowMs < s.backoffUntilMs
}
