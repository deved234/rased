import type { WatchState, WatchStopReason } from '../../shared/projectWatch.js'

export type WatchUiState = 'off' | 'active' | 'waiting'

export interface ReplaceCandidate {
  projectId: number
  startedAt: string | null
  lastChangedAt: string | null
  project?: {
    personalStatus?: string | null
  } | null
}

export function watchButtonState(
  watch: { state: WatchState; version: number; stopReason: WatchStopReason | null } | null | undefined
): WatchUiState {
  if (!watch) return 'off'
  if (watch.state === 'active') return 'active'
  if (watch.state === 'waiting') return 'waiting'
  return 'off'
}

export function watchButtonLabel(state: WatchUiState, lang: 'ar' | 'en'): string {
  if (state === 'active') {
    return lang === 'ar' ? 'تحت المتابعة ✓' : 'Watching ✓'
  }
  if (state === 'waiting') {
    return lang === 'ar' ? 'بانتظار مكان' : 'Waiting for a slot'
  }
  return lang === 'ar' ? 'متابعة' : 'Watch'
}

export function canWatch(source: string | null | undefined): boolean {
  return source === 'mostaql' || source === 'nafezly' || source === 'kaf'
}

export function sortReplaceCandidates<T extends ReplaceCandidate>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aSubmitted = a.project?.personalStatus === 'submitted'
    const bSubmitted = b.project?.personalStatus === 'submitted'
    if (aSubmitted !== bSubmitted) {
      return aSubmitted ? 1 : -1
    }
    const aTime = a.lastChangedAt ?? a.startedAt ?? ''
    const bTime = b.lastChangedAt ?? b.startedAt ?? ''
    if (aTime !== bTime) {
      if (!aTime) return 1
      if (!bTime) return -1
      return aTime.localeCompare(bTime)
    }
    return a.projectId - b.projectId
  })
}

export function shouldApplyWatchResult(
  mounted: boolean,
  currentProjectId: number,
  requestProjectId: number
): boolean {
  return mounted && currentProjectId === requestProjectId
}

export function replaceSelectionAfterReload<T extends { projectId: number }>(
  selectedId: number | null,
  candidates: readonly T[]
): number | null {
  if (selectedId === null) return null
  return candidates.some(c => c.projectId === selectedId) ? selectedId : null
}
