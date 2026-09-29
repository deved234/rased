import { describe, expect, it } from 'vitest'
import { overallSourceState } from '../src/shared/sourceStatus.js'
import type { SourceHealth } from '../src/shared/types.js'

function source(state: SourceHealth['state']): SourceHealth {
  return { state, paused: state === 'paused', lastAttemptAt: null, lastSuccessAt: null, nextAttemptAt: null, consecutiveFailures: 0, lastError: null, lastDurationMs: null, lastItemCount: null, effectiveIntervalMs: 5000 }
}

describe('app-wide source status', () => {
  it('reports a working source without hiding a failure in another enabled source', () => {
    expect(overallSourceState(source('watching'), source('error'), true)).toBe('partial')
    expect(overallSourceState(source('error'), source('watching'), true)).toBe('partial')
  })

  it('ignores a disabled source and reports global pause', () => {
    expect(overallSourceState(source('watching'), source('error'), false)).toBe('watching')
    expect(overallSourceState(source('paused'), source('paused'), true)).toBe('paused')
  })
  it('reports partial monitoring when only one enabled source is paused', () => {
    expect(overallSourceState(source('paused'), source('watching'), true)).toBe('partial')
    expect(overallSourceState(source('watching'), source('paused'), true)).toBe('partial')
  })
})
