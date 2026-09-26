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
  displayQuery: FilterDefinition
  /** show only unread in the list */
  showUnreadOnly: boolean
  /** notify (tagged) about projects whose category could not be confirmed */
  notifyUncertainCategory: boolean
  /** link display and notification filters (both edit together) */
  linkDisplayAndNotifyFilters: boolean
  /** absolute UTC ISO until which toasts are suppressed; null = off */
  doNotDisturbUntil: string | null
  /** compact window bounds; null = OS default placement */
  compactBounds: { x: number; y: number; width: number; height: number } | null
  ui: UiPreferences
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

// ---- v2: personal data, details cache, saved filters, UI prefs ----------

export type PersonalStatus = 'none' | 'interested' | 'submitted' | 'ignored'
export type DetailProvenance = 'excerpt' | 'full' | 'truncated'
export type DetailStatus = 'not_requested' | 'loading' | 'ready' | 'failed'
export type FilterScope = 'all' | 'saved' | 'hidden'
export type SortMode = 'latestDetected' | 'latestPublished'

export interface ProjectUserState {
  projectId: number
  savedAt: string | null
  hiddenAt: string | null
  status: PersonalStatus
  note: string
  updatedAt: string
}

export interface ProjectDetails {
  projectId: number
  text: string | null
  provenance: DetailProvenance | null
  fetchedAt: string | null
  status: DetailStatus
  errorCode: string | null
}

/** Full list-query definition. Every constraint applies before pagination AND count. */
export interface FilterDefinition {
  scope: FilterScope
  unreadOnly: boolean
  /** empty = any status (stored NULL counts as 'none') */
  statuses: PersonalStatus[]
  search: string
  categoryFilter: CategoryFilter
  budgetMin: number | null
  budgetMax: number | null
  /** unknown (null) budgets pass when true (default) */
  includeUnknownBudget: boolean
  sort: SortMode
}

export interface SavedFilter {
  id: string
  name: string
  definition: FilterDefinition
  createdAt: string
  updatedAt: string
}

export interface UiPreferences {
  theme: 'dark' | 'light'
  textScale: 90 | 100 | 110 | 125
  density: 'comfortable' | 'compact'
  sidebarCollapsed: boolean
  previewOpen: boolean
  /** list/preview split ratio, clamped 0.25–0.6 */
  previewRatio: number
  autoRevealNew: boolean
  compactAlwaysOnTop: boolean
  closeBehavior: 'tray' | 'quit'
}

/** Project rows carry joined user flags so lists render without extra fetches. */
export interface ProjectWithUser extends Project {
  saved: boolean
  hidden: boolean
  personalStatus: PersonalStatus
  hasNote: boolean
}

/** Single-project payload: includes the private note body (never in lists). */
export interface ProjectFull extends ProjectWithUser {
  note: string
}

export interface PageResult {
  rows: ProjectWithUser[]
  total: number
  unread: number
}

export interface MutationResult {
  ok: boolean
  error?: string
}

export interface DndState {
  until: string | null
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
  /** ids whose visible data changed (enrichment, read, user state) */
  changedIds: number[]
  summary: { total: number; unread: number } | null
}

export interface DetailsChangedEvent {
  projectIds: number[]
}

export interface NavigateEvent {
  hash: string
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
    displayQuery: defaultFilterDefinition(),
    showUnreadOnly: false,
    notifyUncertainCategory: false,
    linkDisplayAndNotifyFilters: false,
    doNotDisturbUntil: null,
    compactBounds: null,
    ui: defaultUiPreferences()
  }
}

export function defaultUiPreferences(): UiPreferences {
  return {
    theme: 'dark',
    textScale: 100,
    density: 'comfortable',
    sidebarCollapsed: false,
    previewOpen: false,
    previewRatio: 0.45,
    autoRevealNew: false,
    compactAlwaysOnTop: false,
    closeBehavior: 'tray'
  }
}

export function defaultFilterDefinition(): FilterDefinition {
  return {
    scope: 'all',
    unreadOnly: false,
    statuses: [],
    search: '',
    categoryFilter: defaultCategoryFilter(),
    budgetMin: null,
    budgetMax: null,
    includeUnknownBudget: true,
    sort: 'latestDetected'
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
    displayQuery: o['displayQuery'] ? sanitizeFilterDefinition(o['displayQuery']) : { ...defaultFilterDefinition(), categoryFilter: sanitizeFilter(o['displayFilter']), unreadOnly: o['showUnreadOnly'] === true },
    showUnreadOnly: o['showUnreadOnly'] === true,
    notifyUncertainCategory: o['notifyUncertainCategory'] === true,
    linkDisplayAndNotifyFilters: o['linkDisplayAndNotifyFilters'] === true,
    doNotDisturbUntil: sanitizeIsoOrNull(o['doNotDisturbUntil']),
    compactBounds: sanitizeBounds(o['compactBounds']),
    ui: sanitizeUiPreferences(o['ui'])
  }
}

function sanitizeBounds(v: unknown): AppSettings['compactBounds'] {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const nums = [o['x'], o['y'], o['width'], o['height']]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const x = nums[0] as number
  const y = nums[1] as number
  const w = nums[2] as number
  const h = nums[3] as number
  if (w < 240 || w > 1200 || h < 300 || h > 1200) return null
  if (Math.abs(x) > 10000 || Math.abs(y) > 10000) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
}

function sanitizeIsoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const TEXT_SCALES = [90, 100, 110, 125] as const

function sanitizeUiPreferences(v: unknown): UiPreferences {
  const d = defaultUiPreferences()
  if (typeof v !== 'object' || v === null) return d
  const o = v as Record<string, unknown>
  const ratio = typeof o['previewRatio'] === 'number' && Number.isFinite(o['previewRatio']) ? o['previewRatio'] : d.previewRatio
  return {
    theme: o['theme'] === 'light' ? 'light' : 'dark',
    textScale: (TEXT_SCALES as readonly number[]).includes(o['textScale'] as number) ? (o['textScale'] as 90 | 100 | 110 | 125) : 100,
    density: o['density'] === 'compact' ? 'compact' : 'comfortable',
    sidebarCollapsed: o['sidebarCollapsed'] === true,
    previewOpen: o['previewOpen'] === true,
    previewRatio: Math.min(0.6, Math.max(0.25, ratio)),
    autoRevealNew: o['autoRevealNew'] === true,
    compactAlwaysOnTop: o['compactAlwaysOnTop'] === true,
    closeBehavior: o['closeBehavior'] === 'quit' ? 'quit' : 'tray'
  }
}

const PERSONAL_STATUSES: PersonalStatus[] = ['none', 'interested', 'submitted', 'ignored']

export function sanitizePersonalStatus(v: unknown): PersonalStatus {
  return typeof v === 'string' && (PERSONAL_STATUSES as string[]).includes(v) ? (v as PersonalStatus) : 'none'
}

function sanitizeBudgetBound(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) return null
  return v
}

export function sanitizeFilterDefinition(v: unknown): FilterDefinition {
  const d = defaultFilterDefinition()
  if (typeof v !== 'object' || v === null) return d
  const o = v as Record<string, unknown>
  const scope = o['scope']
  const sort = o['sort']
  const statuses = Array.isArray(o['statuses'])
    ? o['statuses'].filter((s): s is PersonalStatus => typeof s === 'string' && (PERSONAL_STATUSES as string[]).includes(s)).slice(0, 4)
    : []
  const budgetMin = sanitizeBudgetBound(o['budgetMin'])
  let budgetMax = sanitizeBudgetBound(o['budgetMax'])
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) budgetMax = budgetMin
  return {
    scope: scope === 'saved' || scope === 'hidden' ? scope : 'all',
    unreadOnly: o['unreadOnly'] === true,
    statuses,
    search: typeof o['search'] === 'string' ? o['search'].slice(0, 200) : '',
    categoryFilter: sanitizeFilter(o['categoryFilter']),
    budgetMin,
    budgetMax,
    includeUnknownBudget: o['includeUnknownBudget'] !== false,
    sort: sort === 'latestPublished' ? 'latestPublished' : 'latestDetected'
  }
}

export function sanitizeSavedFilter(v: unknown): SavedFilter | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o['id'] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(o['id'])) return null
  if (typeof o['name'] !== 'string' || o['name'].trim().length === 0 || o['name'].trim().length > 80) return null
  const created = sanitizeIsoOrNull(o['createdAt']) ?? new Date(0).toISOString()
  const updated = sanitizeIsoOrNull(o['updatedAt']) ?? created
  return {
    id: o['id'],
    name: o['name'].trim(),
    definition: sanitizeFilterDefinition(o['definition']),
    createdAt: created,
    updatedAt: updated
  }
}

export function sanitizeUserStatePatch(v: unknown): { saved?: boolean; hidden?: boolean; status?: PersonalStatus; note?: string } | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const patch: { saved?: boolean; hidden?: boolean; status?: PersonalStatus; note?: string } = {}
  if ('saved' in o) {
    if (typeof o['saved'] !== 'boolean') return null
    patch.saved = o['saved']
  }
  if ('hidden' in o) {
    if (typeof o['hidden'] !== 'boolean') return null
    patch.hidden = o['hidden']
  }
  if ('status' in o) {
    if (typeof o['status'] !== 'string' || !(PERSONAL_STATUSES as string[]).includes(o['status'])) return null
    patch.status = o['status'] as PersonalStatus
  }
  if ('note' in o) {
    if (typeof o['note'] !== 'string' || o['note'].length > 5000) return null
    patch.note = o['note']
  }
  return patch
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
