import { describe, expect, it } from 'vitest'
import {
  canWatch,
  replaceSelectionAfterReload,
  shouldApplyWatchResult,
  sortReplaceCandidates,
  watchButtonLabel,
  watchButtonState,
  type ReplaceCandidate
} from '../src/renderer/components/watchUi.js'

describe('watchUi helpers', () => {
  describe('watchButtonState', () => {
    it('returns off when watch is null or undefined', () => {
      expect(watchButtonState(null)).toBe('off')
      expect(watchButtonState(undefined)).toBe('off')
    })

    it('returns off when watch state is stopped', () => {
      expect(watchButtonState({ state: 'stopped', version: 1, stopReason: 'manual' })).toBe('off')
      expect(watchButtonState({ state: 'stopped', version: 2, stopReason: 'expired' })).toBe('off')
      expect(watchButtonState({ state: 'stopped', version: 3, stopReason: null })).toBe('off')
    })

    it('returns active when watch state is active', () => {
      expect(watchButtonState({ state: 'active', version: 1, stopReason: null })).toBe('active')
      expect(watchButtonState({ state: 'active', version: 5, stopReason: null })).toBe('active')
    })

    it('returns waiting when watch state is waiting', () => {
      expect(watchButtonState({ state: 'waiting', version: 1, stopReason: null })).toBe('waiting')
      expect(watchButtonState({ state: 'waiting', version: 4, stopReason: null })).toBe('waiting')
    })
  })

  describe('watchButtonLabel', () => {
    it('returns exact Arabic and English labels for off state', () => {
      expect(watchButtonLabel('off', 'ar')).toBe('متابعة')
      expect(watchButtonLabel('off', 'en')).toBe('Watch')
    })

    it('returns exact Arabic and English labels for active state', () => {
      expect(watchButtonLabel('active', 'ar')).toBe('تحت المتابعة ✓')
      expect(watchButtonLabel('active', 'en')).toBe('Watching ✓')
    })

    it('returns exact Arabic and English labels for waiting state', () => {
      expect(watchButtonLabel('waiting', 'ar')).toBe('بانتظار مكان')
      expect(watchButtonLabel('waiting', 'en')).toBe('Waiting for a slot')
    })
  })

  describe('canWatch', () => {
    it('returns true for supported platforms (mostaql, nafezly, kaf)', () => {
      expect(canWatch('mostaql')).toBe(true)
      expect(canWatch('nafezly')).toBe(true)
      expect(canWatch('kaf')).toBe(true)
    })

    it('returns false for khamsat and any unsupported source', () => {
      expect(canWatch('khamsat')).toBe(false)
      expect(canWatch('other')).toBe(false)
      expect(canWatch('')).toBe(false)
      expect(canWatch(null)).toBe(false)
      expect(canWatch(undefined)).toBe(false)
    })
  })

  describe('sortReplaceCandidates', () => {
    it('sorts non-submitted candidates before submitted ones', () => {
      const candidates: ReplaceCandidate[] = [
        {
          projectId: 1,
          startedAt: '2026-11-10T10:00:00.000Z',
          lastChangedAt: '2026-11-10T10:00:00.000Z',
          project: { personalStatus: 'submitted' }
        },
        {
          projectId: 2,
          startedAt: '2026-11-11T10:00:00.000Z',
          lastChangedAt: '2026-11-11T10:00:00.000Z',
          project: { personalStatus: 'none' }
        },
        {
          projectId: 3,
          startedAt: '2026-11-12T10:00:00.000Z',
          lastChangedAt: '2026-11-12T10:00:00.000Z',
          project: { personalStatus: 'interested' }
        }
      ]

      const sorted = sortReplaceCandidates(candidates)
      expect(sorted.map(s => s.projectId)).toEqual([2, 3, 1])
    })

    it('sorts oldest (lastChangedAt ?? startedAt) first among same status', () => {
      const candidates: ReplaceCandidate[] = [
        {
          projectId: 1,
          startedAt: '2026-11-12T10:00:00.000Z',
          lastChangedAt: '2026-11-12T10:00:00.000Z',
          project: { personalStatus: 'none' }
        },
        {
          projectId: 2,
          startedAt: '2026-11-10T10:00:00.000Z',
          lastChangedAt: '2026-11-10T10:00:00.000Z',
          project: { personalStatus: 'none' }
        },
        {
          projectId: 3,
          startedAt: '2026-11-09T08:00:00.000Z',
          lastChangedAt: null,
          project: { personalStatus: 'none' }
        }
      ]

      const sorted = sortReplaceCandidates(candidates)
      expect(sorted.map(s => s.projectId)).toEqual([3, 2, 1])
    })

    it('handles opposing timestamps where lastChangedAt is older than startedAt and vice versa', () => {
      // Candidate A: lastChangedAt ('2026-11-01') is older than startedAt ('2026-11-10')
      // Effective timestamp: '2026-11-01'
      const candidateA: ReplaceCandidate = {
        projectId: 101,
        startedAt: '2026-11-10T00:00:00.000Z',
        lastChangedAt: '2026-11-01T00:00:00.000Z',
        project: { personalStatus: 'none' }
      }

      // Candidate B: lastChangedAt ('2026-11-15') is newer than startedAt ('2026-11-02')
      // Effective timestamp: '2026-11-15'
      const candidateB: ReplaceCandidate = {
        projectId: 102,
        startedAt: '2026-11-02T00:00:00.000Z',
        lastChangedAt: '2026-11-15T00:00:00.000Z',
        project: { personalStatus: 'none' }
      }

      // Candidate C: lastChangedAt is null, falls back to startedAt ('2026-11-05')
      // Effective timestamp: '2026-11-05'
      const candidateC: ReplaceCandidate = {
        projectId: 103,
        startedAt: '2026-11-05T00:00:00.000Z',
        lastChangedAt: null,
        project: { personalStatus: 'none' }
      }

      // Expected order: A ('2026-11-01') -> C ('2026-11-05') -> B ('2026-11-15')
      // A precedence bug (e.g. startedAt ?? lastChangedAt) would incorrectly order B ('2026-11-02') -> C ('2026-11-05') -> A ('2026-11-10')
      const sorted = sortReplaceCandidates([candidateB, candidateA, candidateC])
      expect(sorted.map(s => s.projectId)).toEqual([101, 103, 102])
    })

    it('breaks ties using project id ascending', () => {
      const candidates: ReplaceCandidate[] = [
        {
          projectId: 42,
          startedAt: '2026-11-10T10:00:00.000Z',
          lastChangedAt: '2026-11-10T10:00:00.000Z',
          project: { personalStatus: 'none' }
        },
        {
          projectId: 7,
          startedAt: '2026-11-10T10:00:00.000Z',
          lastChangedAt: '2026-11-10T10:00:00.000Z',
          project: { personalStatus: 'none' }
        }
      ]

      const sorted = sortReplaceCandidates(candidates)
      expect(sorted.map(s => s.projectId)).toEqual([7, 42])
    })

    it('does not mutate the original array', () => {
      const candidates: ReplaceCandidate[] = [
        {
          projectId: 10,
          startedAt: '2026-11-12T10:00:00.000Z',
          lastChangedAt: '2026-11-12T10:00:00.000Z',
          project: { personalStatus: 'submitted' }
        },
        {
          projectId: 5,
          startedAt: '2026-11-10T10:00:00.000Z',
          lastChangedAt: '2026-11-10T10:00:00.000Z',
          project: { personalStatus: 'none' }
        }
      ]

      const copy = [...candidates]
      sortReplaceCandidates(candidates)
      expect(candidates).toEqual(copy)
    })
  })

  describe('shouldApplyWatchResult', () => {
    it('returns true only when mounted and project IDs match', () => {
      expect(shouldApplyWatchResult(true, 10, 10)).toBe(true)
    })

    it('returns false when component is unmounted', () => {
      expect(shouldApplyWatchResult(false, 10, 10)).toBe(false)
      expect(shouldApplyWatchResult(false, 10, 20)).toBe(false)
    })

    it('returns false when currentProjectId has changed', () => {
      expect(shouldApplyWatchResult(true, 20, 10)).toBe(false)
    })
  })

  describe('replaceSelectionAfterReload', () => {
    const list = [{ projectId: 1 }, { projectId: 2 }, { projectId: 3 }]

    it('returns null when selectedId is null', () => {
      expect(replaceSelectionAfterReload(null, list)).toBeNull()
    })

    it('returns selectedId when selected candidate is still present', () => {
      expect(replaceSelectionAfterReload(2, list)).toBe(2)
    })

    it('returns null when selected candidate is no longer in the list', () => {
      expect(replaceSelectionAfterReload(99, list)).toBeNull()
      expect(replaceSelectionAfterReload(2, [])).toBeNull()
    })
  })
})
