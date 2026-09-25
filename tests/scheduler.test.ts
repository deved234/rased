import { describe, expect, it } from 'vitest'
import {
  BACKOFF_CAP_MS,
  NEEDS_REVIEW_FLOOR_MS,
  delayUntilNext,
  initialSchedulerState,
  isBackingOff,
  noteFailure,
  noteSuccess
} from '../src/collector/scheduler.js'

const fixed = () => 0.5 // deterministic jitter (1.0x)

describe('scheduler', () => {
  it('starts immediately, honors the interval, and rests after completion', () => {
    const s = initialSchedulerState()
    expect(delayUntilNext(s, 5000, 1000, null)).toBe(0)
    expect(delayUntilNext(s, 5000, 1000, 1000)).toBe(5000)
    expect(delayUntilNext(s, 5000, 5000, 0, 4800)).toBe(800)
    expect(delayUntilNext(s, 5000, 8000, 1000)).toBe(0)
  })

  it('does not chase missed cycles after a slow request', () => {
    const s = initialSchedulerState()
    // request started at 0, still running at 20000 with 5s interval: next starts now-ish, never a burst
    expect(delayUntilNext(s, 5000, 20000, 0, 20000)).toBe(1000)
  })

  it('backs off progressively and recovers on success', () => {
    let s = initialSchedulerState()
    s = noteFailure(s, { kind: 'timeout', retryAfterMs: null, nowMs: 0, random: fixed })
    expect(s.consecutiveFailures).toBe(1)
    expect(s.backoffUntilMs).toBe(10_000)
    expect(isBackingOff(s, 9_999)).toBe(true)
    s = noteFailure(s, { kind: 'timeout', retryAfterMs: null, nowMs: 10_000, random: fixed })
    expect(s.backoffUntilMs).toBe(30_000) // +20s ladder
    s = noteSuccess(s, 30_000)
    expect(s.consecutiveFailures).toBe(0)
    expect(s.backoffUntilMs).toBeNull()
  })

  it('honors a longer Retry-After over the local ladder and cap', () => {
    let s = initialSchedulerState()
    s = noteFailure(s, { kind: 'rate_limited', retryAfterMs: 600_000, nowMs: 0, random: fixed })
    expect(s.backoffUntilMs).toBe(600_000)
    expect(BACKOFF_CAP_MS).toBe(300_000)
  })

  it('treats forbidden as needs-review with a slow floor, never hammering', () => {
    let s = initialSchedulerState()
    s = noteFailure(s, { kind: 'forbidden', retryAfterMs: null, nowMs: 0, random: fixed })
    expect(s.needsReview).toBe(true)
    expect(s.backoffUntilMs).toBe(NEEDS_REVIEW_FLOOR_MS)
    // success clears the review flag
    expect(noteSuccess(s, NEEDS_REVIEW_FLOOR_MS).needsReview).toBe(false)
  })

  it('pause blocks scheduling', () => {
    expect(delayUntilNext({ ...initialSchedulerState(), paused: true }, 5000, 0, null)).toBe(-1)
  })
})
