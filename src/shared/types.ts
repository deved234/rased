// Shared domain types — used by main, preload, renderer and tests.
// Times are ISO-8601 UTC strings in storage; UI formats them locally.

export type DiscoveryKind = 'initial' | 'live' | 'recovered'
export type EnrichmentStatus = 'not_requested' | 'pending' | 'ready' | 'failed'
export type NotifyEventStatus = 'pending' | 'dispatching' | 'submitted' | 'failed' | 'uncertain' | 'suppressed'
export type HealthState =
  | 'initializing'
  | 'watching'
  | 'paused'
  | 'offline'
  | 'backing-off'
  | 'needs-review'
  | 'error'

export interface Project {
  id: number
  source: string
  externalId: string
  url: string
  title: string
  descriptionExcerpt: string
  publishedAt: string | null
  publishedRaw: string | null
  firstSeenAt: string
  lastSeenAt: string
  discoveryKind: DiscoveryKind
  readAt: string | null
  categorySlug: string | null
  categoryName: string | null
  categoryConfirmed: boolean
  skills: string[] | null
  budgetMin: number | null
  budgetMax: number | null
  currency: string | null
  budgetRaw: string | null
  enrichmentStatus: EnrichmentStatus
}

export interface CategoryFilter {
  /** 'all' = every category; 'selected' = only listed slugs */
  mode: 'all' | 'selected'
  categories: string[]
  /** match if ANY of these substrings appears (title/excerpt/skills) */
  keywordsAny: string[]
  /** match only if ALL of these appear */
  keywordsAll: string[]
  /** exclude when any appears */
  excludeKeywords: string[]
}

export interface AppSettings {
  language: 'ar' | 'en'
  /** polling interval chosen by the user; backoff/Retry-After override it */
  pollIntervalMs: 2000 | 5000 | 15000
  notificationsEnabled: boolean
  soundEnabled: boolean
  runAtStartup: boolean
  /** filter used for notifications */
  notifyFilter: CategoryFilter
  /** filter used for the list display */
  displayFilter: CategoryFilter
  /** show only unread in the list */
  showUnreadOnly: boolean
  /** notify (tagged) about projects whose category could not be confirmed */
  notifyUncertainCategory: boolean
}

export interface SourceHealth {
  state: HealthState
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  nextAttemptAt: string | null
  consecutiveFailures: number
  lastError: string | null
  lastDurationMs: number | null
  lastItemCount: number | null
  /** effective interval currently driving the loop (base or backoff) */
  effectiveIntervalMs: number
  paused: boolean
}

export interface ProjectQuery {
  limit: number
  offset: number
  unreadOnly?: boolean
  search?: string
  /** category slugs; special value '__uncertain' matches unconfirmed */
  categories?: string[]
  displayFilter?: CategoryFilter
}

export interface NotifyEvent {
  id: number
  projectId: number
  kind: string
  status: NotifyEventStatus
}

export interface DiagnosticEntry {
  at: string
  endpointKind: string
  status: string
  durationMs: number
  itemCount: number | null
  errorCategory: string | null
  detail: string | null
}

// ---- IPC payloads ---------------------------------------------------------

export interface OpenProjectResult {
  ok: boolean
  error?: string
}

export interface RefreshResult {
  ok: boolean
  /** false when the manual refresh was correctly refused (backoff/overlap) */
  started: boolean
  reason?: string
}

export interface RendererProjectEvent {
  episode: number
  newIds: number[]
  summary: { total: number; unread: number } | null
}

export function defaultCategoryFilter(): CategoryFilter {
  return { mode: 'all', categories: [], keywordsAny: [], keywordsAll: [], excludeKeywords: [] }
}

export function defaultSettings(): AppSettings {
  return {
    language: 'ar',
    pollIntervalMs: 5000,
    notificationsEnabled: true,
    soundEnabled: true,
    runAtStartup: false,
    notifyFilter: defaultCategoryFilter(),
    displayFilter: defaultCategoryFilter(),
    showUnreadOnly: false,
    notifyUncertainCategory: false
  }
}

const POLL_CHOICES = [2000, 5000, 15000] as const

/** Merge unknown input over defaults; never throws, never trusts types. */
export function sanitizeSettings(input: unknown): AppSettings {
  const base = defaultSettings()
  if (typeof input !== 'object' || input === null) return base
  const o = input as Record<string, unknown>
  const lang = o['language'] === 'en' ? 'en' : 'ar'
  const poll = POLL_CHOICES.includes(o['pollIntervalMs'] as 2000) ? (o['pollIntervalMs'] as 2000 | 5000 | 15000) : 5000
  return {
    language: lang,
    pollIntervalMs: poll,
    notificationsEnabled: typeof o['notificationsEnabled'] === 'boolean' ? o['notificationsEnabled'] : true,
    soundEnabled: typeof o['soundEnabled'] === 'boolean' ? o['soundEnabled'] : true,
    runAtStartup: typeof o['runAtStartup'] === 'boolean' ? o['runAtStartup'] : false,
    notifyFilter: sanitizeFilter(o['notifyFilter']),
    displayFilter: sanitizeFilter(o['displayFilter']),
    showUnreadOnly: o['showUnreadOnly'] === true,
    notifyUncertainCategory: o['notifyUncertainCategory'] === true
  }
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 120)).slice(0, 100)
}

function sanitizeFilter(v: unknown): CategoryFilter {
  const d = defaultCategoryFilter()
  if (typeof v !== 'object' || v === null) return d
  const o = v as Record<string, unknown>
  return {
    mode: o['mode'] === 'selected' ? 'selected' : 'all',
    categories: stringList(o['categories']),
    keywordsAny: stringList(o['keywordsAny']),
    keywordsAll: stringList(o['keywordsAll']),
    excludeKeywords: stringList(o['excludeKeywords'])
  }
}
