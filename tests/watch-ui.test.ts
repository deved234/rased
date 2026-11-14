import { describe, expect, it } from 'vitest'
import {
  canWatch,
  canWatchAgain,
  replaceSelectionAfterReload,
  shouldApplyWatchResult,
  sortReplaceCandidates,
  watchButtonLabel,
  watchButtonState,
  watchFactsLines,
  watchFailureLine,
  watchFocusTarget,
  watchMostaqlFactsLines,
  watchOffersLabel,
  watchPlatformCounter,
  watchStatusLabel,
  watchStoppedLine,
  watchStopReasonLabel,
  watchWaitingLine,
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

  describe('watchStatusLabel', () => {
    it('returns not checked yet in Arabic and English when lastAttemptAt is null or undefined', () => {
      expect(watchStatusLabel('open', null, 'ar')).toBe('لم يُفحص بعد')
      expect(watchStatusLabel('open', null, 'en')).toBe('Not checked yet')
      expect(watchStatusLabel(null, undefined, 'ar')).toBe('لم يُفحص بعد')
      expect(watchStatusLabel(null, undefined, 'en')).toBe('Not checked yet')
    })

    it('returns exact status labels in Arabic and English when lastAttemptAt is present', () => {
      const at = '2026-11-14T10:00:00.000Z'
      expect(watchStatusLabel('open', at, 'ar')).toBe('الحالة: مفتوح')
      expect(watchStatusLabel('open', at, 'en')).toBe('Status: open')

      expect(watchStatusLabel('in_progress', at, 'ar')).toBe('الحالة: قيد التنفيذ')
      expect(watchStatusLabel('in_progress', at, 'en')).toBe('Status: in progress')

      expect(watchStatusLabel('closed', at, 'ar')).toBe('الحالة: مغلق')
      expect(watchStatusLabel('closed', at, 'en')).toBe('Status: closed')

      expect(watchStatusLabel('completed', at, 'ar')).toBe('الحالة: مكتمل')
      expect(watchStatusLabel('completed', at, 'en')).toBe('Status: completed')

      expect(watchStatusLabel('unknown', at, 'ar')).toBe('الحالة: غير معروف')
      expect(watchStatusLabel('unknown', at, 'en')).toBe('Status: unknown')

      expect(watchStatusLabel(null, at, 'ar')).toBe('الحالة: غير معروف')
      expect(watchStatusLabel(null, at, 'en')).toBe('Status: unknown')
    })
  })

  describe('watchStopReasonLabel and watchStoppedLine', () => {
    it('returns exact reasons in both Arabic and English', () => {
      expect(watchStopReasonLabel('manual', 'ar')).toBe('يدويًا')
      expect(watchStopReasonLabel('manual', 'en')).toBe('manually')

      expect(watchStopReasonLabel('replaced', 'ar')).toBe('تم استبدالها')
      expect(watchStopReasonLabel('replaced', 'en')).toBe('replaced')

      expect(watchStopReasonLabel('closed', 'ar')).toBe('أُغلق المشروع')
      expect(watchStopReasonLabel('closed', 'en')).toBe('project closed')

      expect(watchStopReasonLabel('expired', 'ar')).toBe('انتهت مدة الـ14 يومًا')
      expect(watchStopReasonLabel('expired', 'en')).toBe('14 days ended')

      expect(watchStopReasonLabel('ignored', 'ar')).toBe('تم التجاهل')
      expect(watchStopReasonLabel('ignored', 'en')).toBe('ignored')

      expect(watchStopReasonLabel('gone', 'ar')).toBe('لم يعد متاحًا')
      expect(watchStopReasonLabel('gone', 'en')).toBe('no longer available')

      expect(watchStopReasonLabel('source_disabled', 'ar')).toBe('تم تعطيل المنصة')
      expect(watchStopReasonLabel('source_disabled', 'en')).toBe('platform disabled')

      expect(watchStopReasonLabel(null, 'ar')).toBe('غير معروف')
      expect(watchStopReasonLabel(null, 'en')).toBe('unknown')
    })

    it('formats stopped lines with prefix in Arabic and English', () => {
      expect(watchStoppedLine('manual', 'ar')).toBe('توقفت: يدويًا')
      expect(watchStoppedLine('manual', 'en')).toBe('Stopped: manually')

      expect(watchStoppedLine('closed', 'ar')).toBe('توقفت: أُغلق المشروع')
      expect(watchStoppedLine('closed', 'en')).toBe('Stopped: project closed')
    })
  })

  describe('watchOffersLabel', () => {
    it('returns null when offers is null or undefined', () => {
      expect(watchOffersLabel(null, false, 'ar')).toBeNull()
      expect(watchOffersLabel(undefined, false, 'en')).toBeNull()
    })

    it('formats normal offers count in Arabic and English', () => {
      expect(watchOffersLabel(12, false, 'ar')).toBe('العروض: 12')
      expect(watchOffersLabel(12, false, 'en')).toBe('Offers: 12')
    })

    it('formats capped offers as 50+ in Arabic and English', () => {
      expect(watchOffersLabel(50, true, 'ar')).toBe('العروض: 50+')
      expect(watchOffersLabel(50, true, 'en')).toBe('Offers: 50+')
    })
  })

  describe('watchMostaqlFactsLines', () => {
    it('returns empty array when source is not mostaql', () => {
      expect(watchMostaqlFactsLines('nafezly', { contacts: 3, clientOpen: 1, clientInProgress: 0 }, 'ar')).toEqual([])
      expect(watchMostaqlFactsLines('kaf', { contacts: 3, clientOpen: 1, clientInProgress: 0 }, 'en')).toEqual([])
      expect(watchMostaqlFactsLines(null, { contacts: 3, clientOpen: 1, clientInProgress: 0 }, 'ar')).toEqual([])
    })

    it('formats client facts when present on mostaql projects', () => {
      const facts = { contacts: 5, clientOpen: 2, clientInProgress: 1 }
      expect(watchMostaqlFactsLines('mostaql', facts, 'ar')).toEqual([
        'تواصلات صاحب المشروع: 5',
        'مشاريعه المفتوحة: 2',
        'قيد التنفيذ عنده: 1'
      ])
      expect(watchMostaqlFactsLines('mostaql', facts, 'en')).toEqual([
        'Client conversations: 5',
        'Client open projects: 2',
        'Client in progress: 1'
      ])
    })

    it('omits null client facts on mostaql projects', () => {
      const facts = { contacts: 4, clientOpen: null, clientInProgress: null }
      expect(watchMostaqlFactsLines('mostaql', facts, 'ar')).toEqual(['تواصلات صاحب المشروع: 4'])
      expect(watchMostaqlFactsLines('mostaql', facts, 'en')).toEqual(['Client conversations: 4'])
    })
  })

  describe('watchWaitingLine and watchFailureLine', () => {
    it('returns exact waiting line in Arabic and English', () => {
      expect(watchWaitingLine('ar')).toBe('وصلت للحد 10 — بانتظار مكان')
      expect(watchWaitingLine('en')).toBe('Limit of 10 reached — waiting for a slot')
    })

    it('returns exact check failed line in Arabic and English', () => {
      expect(watchFailureLine('ar')).toBe('تعذّر الفحص')
      expect(watchFailureLine('en')).toBe('Check failed')
    })
  })

  describe('canWatchAgain', () => {
    it('returns true when status is open, null, undefined, or unknown', () => {
      expect(canWatchAgain('open')).toBe(true)
      expect(canWatchAgain(null)).toBe(true)
      expect(canWatchAgain(undefined)).toBe(true)
      expect(canWatchAgain('unknown')).toBe(true)
    })

    it('returns false when status is in_progress, closed, or completed', () => {
      expect(canWatchAgain('in_progress')).toBe(false)
      expect(canWatchAgain('closed')).toBe(false)
      expect(canWatchAgain('completed')).toBe(false)
    })
  })

  describe('watchPlatformCounter', () => {
    it('formats platform active/cap count without pause when pausedUntil is null', () => {
      const counterAr = watchPlatformCounter('mostaql', { active: 3, cap: 10, pausedUntil: null }, 'ar')
      expect(counterAr).toBe('مستقل: 3 / 10')

      const counterEn = watchPlatformCounter('nafezly', { active: 10, cap: 10, pausedUntil: null }, 'en')
      expect(counterEn).toBe('Nafezly: 10 / 10')
    })

    it('appends pause protection note when pausedUntil is in the future', () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      const counterAr = watchPlatformCounter('kaf', { active: 2, cap: 10, pausedUntil: future }, 'ar')
      expect(counterAr).toBe('كاف: 2 / 10 — متوقفة مؤقتًا لحماية الرصد')

      const counterEn = watchPlatformCounter('mostaql', { active: 5, cap: 10, pausedUntil: future }, 'en')
      expect(counterEn).toBe('Mostaql: 5 / 10 — paused to protect monitoring')
    })

    it('does not append pause note when pausedUntil is in the past', () => {
      const past = new Date(Date.now() - 60_000).toISOString()
      const counterAr = watchPlatformCounter('mostaql', { active: 3, cap: 10, pausedUntil: past }, 'ar')
      expect(counterAr).toBe('مستقل: 3 / 10')
    })

    it('handles explicit clock boundary: pausedUntil exactly now = not paused, +1 ms = paused', () => {
      const fixedNow = 1_700_000_000_000
      const exactlyNow = new Date(fixedNow).toISOString()
      const oneMsFuture = new Date(fixedNow + 1).toISOString()

      const notPaused = watchPlatformCounter('mostaql', { active: 3, cap: 10, pausedUntil: exactlyNow }, 'ar', fixedNow)
      expect(notPaused).toBe('مستقل: 3 / 10')

      const paused = watchPlatformCounter('mostaql', { active: 3, cap: 10, pausedUntil: oneMsFuture }, 'ar', fixedNow)
      expect(paused).toBe('مستقل: 3 / 10 — متوقفة مؤقتًا لحماية الرصد')
    })
  })

  describe('watchFactsLines', () => {
    const mockTimeAgo = (iso: string | null) => (iso ? 'منذ قليل' : '')

    it('formats all facts for an active mostaql row', () => {
      const lines = watchFactsLines(
        {
          state: 'active',
          status: 'open',
          offers: 15,
          offersCapped: false,
          contacts: 2,
          clientOpen: 1,
          clientInProgress: 0,
          lastAttemptAt: '2026-11-14T10:00:00.000Z',
          lastChangedAt: '2026-11-14T09:30:00.000Z',
          failures: 0,
          stopReason: null,
          project: { source: 'mostaql' }
        },
        'ar',
        mockTimeAgo
      )

      expect(lines).toEqual([
        'الحالة: مفتوح',
        'العروض: 15',
        'تواصلات صاحب المشروع: 2',
        'مشاريعه المفتوحة: 1',
        'قيد التنفيذ عنده: 0',
        'آخر تغيير: منذ قليل',
        'آخر فحص: منذ قليل'
      ])
    })

    it('includes limit message for waiting rows and failure line when failures > 0', () => {
      const lines = watchFactsLines(
        {
          state: 'waiting',
          status: null,
          offers: null,
          offersCapped: false,
          contacts: null,
          clientOpen: null,
          clientInProgress: null,
          lastAttemptAt: null,
          lastChangedAt: null,
          failures: 2,
          stopReason: null,
          project: { source: 'nafezly' }
        },
        'ar',
        mockTimeAgo
      )

      expect(lines).toEqual([
        'لم يُفحص بعد',
        'تعذّر الفحص',
        'وصلت للحد 10 — بانتظار مكان'
      ])
    })

    it('includes stopped reason for stopped rows', () => {
      const lines = watchFactsLines(
        {
          state: 'stopped',
          status: 'closed',
          offers: 50,
          offersCapped: true,
          contacts: null,
          clientOpen: null,
          clientInProgress: null,
          lastAttemptAt: '2026-11-14T10:00:00.000Z',
          lastChangedAt: null,
          failures: 0,
          stopReason: 'closed',
          project: { source: 'kaf' }
        },
        'en',
        () => 'just now'
      )

      expect(lines).toEqual([
        'Status: closed',
        'Offers: 50+',
        'Last check: just now',
        'Stopped: project closed'
      ])
    })

    it('formats distinct values when lastChangedAt and lastAttemptAt differ so swapping fails', () => {
      const changedIso = '2026-11-14T08:00:00.000Z'
      const attemptIso = '2026-11-14T10:00:00.000Z'
      const distinctTimeFormatter = (iso: string | null) => {
        if (iso === changedIso) return 'قبل ساعتين'
        if (iso === attemptIso) return 'منذ دقيقة'
        return 'غير محدد'
      }

      const lines = watchFactsLines(
        {
          state: 'active',
          status: 'open',
          offers: 5,
          offersCapped: false,
          contacts: null,
          clientOpen: null,
          clientInProgress: null,
          lastAttemptAt: attemptIso,
          lastChangedAt: changedIso,
          failures: 0,
          stopReason: null,
          project: { source: 'nafezly' }
        },
        'ar',
        distinctTimeFormatter
      )

      expect(lines).toContain('آخر تغيير: قبل ساعتين')
      expect(lines).toContain('آخر فحص: منذ دقيقة')
      expect(lines).not.toContain('آخر تغيير: منذ دقيقة')
      expect(lines).not.toContain('آخر فحص: قبل ساعتين')
      const changeIdx = lines.indexOf('آخر تغيير: قبل ساعتين')
      const checkIdx = lines.indexOf('آخر فحص: منذ دقيقة')
      expect(changeIdx).toBeGreaterThan(-1)
      expect(checkIdx).toBeGreaterThan(-1)
      expect(changeIdx).toBeLessThan(checkIdx)
    })
  })

  describe('watchFocusTarget', () => {
    const present = [10, 20, 30]

    it('returns target control when row moved to another section but is still present', () => {
      expect(watchFocusTarget(20, 'title', present)).toEqual({ kind: 'title', id: 20 })
      expect(watchFocusTarget(20, 'button', present)).toEqual({ kind: 'button', id: 20 })
    })

    it('returns heading when row was removed from watched list', () => {
      expect(watchFocusTarget(99, 'title', present)).toEqual({ kind: 'heading', id: null })
      expect(watchFocusTarget(99, 'button', present)).toEqual({ kind: 'heading', id: null })
    })

    it('returns heading when nothing was recorded or id is null', () => {
      expect(watchFocusTarget(null, null, present)).toEqual({ kind: 'heading', id: null })
      expect(watchFocusTarget(null, 'title', present)).toEqual({ kind: 'heading', id: null })
      expect(watchFocusTarget(null, 'button', present)).toEqual({ kind: 'heading', id: null })
      expect(watchFocusTarget(20, null, present)).toEqual({ kind: 'heading', id: null })
    })

    it('differentiates button vs title control kinds correctly', () => {
      const resButton = watchFocusTarget(10, 'button', present)
      expect(resButton.kind).toBe('button')
      expect(resButton.id).toBe(10)

      const resTitle = watchFocusTarget(10, 'title', present)
      expect(resTitle.kind).toBe('title')
      expect(resTitle.id).toBe(10)
    })
  })
})
