import type { WatchPlatformStatus } from './projectWatch.js'

const VALID_STATUSES: ReadonlySet<string> = new Set<WatchPlatformStatus>([
  'open',
  'in_progress',
  'closed',
  'completed',
  'unknown'
])

export type ValidWatchPayload =
  | { kind: 'watch_status'; v: 1; from: WatchPlatformStatus; to: 'in_progress' | 'closed' | 'completed' }
  | { kind: 'watch_contact'; v: 1; from: number; to: number; attribution: 'sure' | 'maybe'; clientOpen: number | null }

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
}

export function parseWatchPayload(kind: unknown, raw: unknown): ValidWatchPayload | null {
  if (kind !== 'watch_status' && kind !== 'watch_contact') return null
  if (typeof raw !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const p = parsed as Record<string, unknown>
  if (p['v'] !== 1) return null

  if (kind === 'watch_status') {
    const from = p['from']
    if (typeof from !== 'string' || !VALID_STATUSES.has(from)) return null
    const to = p['to']
    if (to !== 'in_progress' && to !== 'closed' && to !== 'completed') return null
    return {
      kind: 'watch_status',
      v: 1,
      from: from as WatchPlatformStatus,
      to
    }
  }

  // kind === 'watch_contact'
  if (!isNonNegativeInteger(p['from']) || !isNonNegativeInteger(p['to'])) return null
  const attribution = p['attribution']
  if (attribution !== 'sure' && attribution !== 'maybe') return null
  if (!('clientOpen' in p)) return null
  const clientOpen = p['clientOpen']
  if (clientOpen !== null && !isNonNegativeInteger(clientOpen)) return null

  return {
    kind: 'watch_contact',
    v: 1,
    from: p['from'],
    to: p['to'],
    attribution,
    clientOpen
  }
}

export function watchNotificationText(
  payload: ValidWatchPayload,
  lang: 'ar' | 'en'
): string {
  if (payload.kind === 'watch_status') {
    if (payload.to === 'in_progress') {
      return lang === 'ar' ? 'المشروع دخل مرحلة التنفيذ' : 'The project moved to in progress'
    }
    if (payload.to === 'closed') {
      return lang === 'ar' ? 'المشروع أُغلق — توقفت المتابعة' : 'The project was closed — watching stopped'
    }
    return lang === 'ar' ? 'المشروع اكتمل — توقفت المتابعة' : 'The project was completed — watching stopped'
  }

  // watch_contact
  const m = payload.from
  const n = payload.to
  if (payload.attribution === 'sure') {
    return lang === 'ar'
      ? `العميل بدأ يتواصل مع مستقلين على هذا المشروع (${m} ← ${n})`
      : `The client started talking to freelancers on this project (${m} → ${n})`
  }

  // attribution === 'maybe'
  if (typeof payload.clientOpen === 'number' && payload.clientOpen >= 2) {
    const k = payload.clientOpen
    return lang === 'ar'
      ? `صاحب المشروع بدأ يتواصل مع مستقلين (${m} ← ${n}). عنده ${k} مشاريع مفتوحة، فقد يكون على هذا المشروع`
      : `The client started talking to freelancers (${m} → ${n}). They have ${k} open projects, so it may be this one`
  }

  return lang === 'ar'
    ? `صاحب المشروع بدأ يتواصل مع مستقلين (${m} ← ${n}) — قد يكون على هذا المشروع`
    : `The client started talking to freelancers (${m} → ${n}) — it may be this project`
}

export function watchSummaryTitle(count: number, lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? `تغييرات في ${count} مشاريع تتابعها`
    : `Changes in ${count} projects you watch`
}

export function watchAwayTitle(count: number, lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? `حصل وأنت غايب: تغييرات في ${count} مشاريع`
    : `While you were away: changes in ${count} projects`
}

