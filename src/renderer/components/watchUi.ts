import type {
  WatchPlatformStatus,
  WatchSource,
  WatchState,
  WatchStopReason
} from '../../shared/projectWatch.js'
import { WATCH_CAP_PER_SOURCE } from '../../shared/projectWatch.js'
import { sourceName } from '../sourceCopy.js'

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

export function watchStatusLabel(
  status: WatchPlatformStatus | null | undefined,
  lastAttemptAt: string | null | undefined,
  lang: 'ar' | 'en'
): string {
  if (lastAttemptAt === null || lastAttemptAt === undefined) {
    return lang === 'ar' ? 'لم يُفحص بعد' : 'Not checked yet'
  }
  const prefix = lang === 'ar' ? 'الحالة: ' : 'Status: '
  let name: string
  switch (status) {
    case 'open':
      name = lang === 'ar' ? 'مفتوح' : 'open'
      break
    case 'in_progress':
      name = lang === 'ar' ? 'قيد التنفيذ' : 'in progress'
      break
    case 'closed':
      name = lang === 'ar' ? 'مغلق' : 'closed'
      break
    case 'completed':
      name = lang === 'ar' ? 'مكتمل' : 'completed'
      break
    case 'unknown':
    default:
      name = lang === 'ar' ? 'غير معروف' : 'unknown'
      break
  }
  return prefix + name
}

export function watchStopReasonLabel(
  reason: WatchStopReason | null | undefined,
  lang: 'ar' | 'en'
): string {
  switch (reason) {
    case 'manual':
      return lang === 'ar' ? 'يدويًا' : 'manually'
    case 'replaced':
      return lang === 'ar' ? 'تم استبدالها' : 'replaced'
    case 'closed':
      return lang === 'ar' ? 'أُغلق المشروع' : 'project closed'
    case 'expired':
      return lang === 'ar' ? 'انتهت مدة الـ14 يومًا' : '14 days ended'
    case 'ignored':
      return lang === 'ar' ? 'تم التجاهل' : 'ignored'
    case 'gone':
      return lang === 'ar' ? 'لم يعد متاحًا' : 'no longer available'
    case 'source_disabled':
      return lang === 'ar' ? 'تم تعطيل المنصة' : 'platform disabled'
    default:
      return lang === 'ar' ? 'غير معروف' : 'unknown'
  }
}

export function watchStoppedLine(
  reason: WatchStopReason | null | undefined,
  lang: 'ar' | 'en'
): string {
  const reasonText = watchStopReasonLabel(reason, lang)
  return lang === 'ar' ? `توقفت: ${reasonText}` : `Stopped: ${reasonText}`
}

export function watchOffersLabel(
  offers: number | null | undefined,
  offersCapped: boolean,
  lang: 'ar' | 'en'
): string | null {
  if (offers === null || offers === undefined) return null
  const countStr = offersCapped ? '50+' : String(offers)
  return lang === 'ar' ? `العروض: ${countStr}` : `Offers: ${countStr}`
}

export function watchMostaqlFactsLines(
  source: string | null | undefined,
  facts: { contacts?: number | null; clientOpen?: number | null; clientInProgress?: number | null },
  lang: 'ar' | 'en'
): string[] {
  if (source !== 'mostaql') return []
  const lines: string[] = []
  if (facts.contacts !== null && facts.contacts !== undefined) {
    lines.push(
      lang === 'ar'
        ? `تواصلات صاحب المشروع: ${facts.contacts}`
        : `Client conversations: ${facts.contacts}`
    )
  }
  if (facts.clientOpen !== null && facts.clientOpen !== undefined) {
    lines.push(
      lang === 'ar'
        ? `مشاريعه المفتوحة: ${facts.clientOpen}`
        : `Client open projects: ${facts.clientOpen}`
    )
  }
  if (facts.clientInProgress !== null && facts.clientInProgress !== undefined) {
    lines.push(
      lang === 'ar'
        ? `قيد التنفيذ عنده: ${facts.clientInProgress}`
        : `Client in progress: ${facts.clientInProgress}`
    )
  }
  return lines
}

export function watchWaitingLine(lang: 'ar' | 'en'): string {
  return lang === 'ar' ? 'وصلت للحد 10 — بانتظار مكان' : 'Limit of 10 reached — waiting for a slot'
}

export function watchFailureLine(lang: 'ar' | 'en'): string {
  return lang === 'ar' ? 'تعذّر الفحص' : 'Check failed'
}

export function canWatchAgain(status: WatchPlatformStatus | null | undefined): boolean {
  return status === 'open' || status === null || status === undefined || status === 'unknown'
}

export function watchPlatformCounter(
  source: WatchSource,
  counts: { active: number; cap: number; pausedUntil: string | null } | undefined,
  lang: 'ar' | 'en',
  now: number = Date.now()
): string {
  const name = sourceName(source, lang)
  const active = counts?.active ?? 0
  const cap = counts?.cap ?? WATCH_CAP_PER_SOURCE
  let text = `${name}: ${active} / ${cap}`
  if (counts?.pausedUntil && Date.parse(counts.pausedUntil) > now) {
    text += lang === 'ar' ? ' — متوقفة مؤقتًا لحماية الرصد' : ' — paused to protect monitoring'
  }
  return text
}

export interface WatchFactsRow {
  state: WatchState
  status: WatchPlatformStatus | null
  offers: number | null
  offersCapped: boolean
  contacts: number | null
  clientOpen: number | null
  clientInProgress: number | null
  lastAttemptAt: string | null
  lastChangedAt: string | null
  failures: number
  stopReason: WatchStopReason | null
  project?: {
    source?: string
  } | null
}

export function watchFactsLines(
  row: WatchFactsRow,
  lang: 'ar' | 'en',
  formatTime: (iso: string | null, lang: 'ar' | 'en') => string
): string[] {
  const facts: string[] = []

  facts.push(watchStatusLabel(row.status, row.lastAttemptAt, lang))

  const offersLabel = watchOffersLabel(row.offers, row.offersCapped, lang)
  if (offersLabel !== null) {
    facts.push(offersLabel)
  }

  const mostaqlLines = watchMostaqlFactsLines(row.project?.source, row, lang)
  facts.push(...mostaqlLines)

  if (row.lastChangedAt) {
    const formattedChange = formatTime(row.lastChangedAt, lang)
    facts.push(lang === 'ar' ? `آخر تغيير: ${formattedChange}` : `Last change: ${formattedChange}`)
  }

  if (row.lastAttemptAt) {
    const formattedAttempt = formatTime(row.lastAttemptAt, lang)
    facts.push(lang === 'ar' ? `آخر فحص: ${formattedAttempt}` : `Last check: ${formattedAttempt}`)
  }

  if (row.failures > 0) {
    facts.push(watchFailureLine(lang))
  }

  if (row.state === 'waiting') {
    facts.push(watchWaitingLine(lang))
  }

  if (row.state === 'stopped') {
    facts.push(watchStoppedLine(row.stopReason, lang))
  }

  return facts
}

export type WatchFocusKind = 'title' | 'button' | 'heading'

export interface WatchFocusTargetResult {
  kind: WatchFocusKind
  id: number | null
}

export function watchFocusTarget(
  recordedId: number | null,
  recordedKind: 'title' | 'button' | null,
  presentIds: readonly number[]
): WatchFocusTargetResult {
  if (recordedId !== null && recordedKind !== null && presentIds.includes(recordedId)) {
    return { kind: recordedKind, id: recordedId }
  }
  return { kind: 'heading', id: null }
}
