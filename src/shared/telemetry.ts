import type { SourceId } from './sources.js'
import type { WatchSource } from './projectWatch.js'

export const TELEMETRY_DISCLOSURE = '2026-11-14-v5'
export const ANALYTICS_SUPPORT = 'https://wa.me/201201780258'
// Type-only import above: scripts load this file directly in Node, so no runtime import of projectWatch.
const WATCH_TELEMETRY_SOURCES: readonly WatchSource[] = ['mostaql', 'nafezly', 'kaf']
export const TELEMETRY_SOURCES = ['mostaql', 'khamsat', 'nafezly', 'kaf'] as const
export const TELEMETRY_SUMMARIES = ['monitoring_hourly', 'notification_summary', 'watch_hourly'] as const
export type TelemetrySummaryName = typeof TELEMETRY_SUMMARIES[number]
export type TelemetryOutcome = 'success' | 'failed' | 'cancelled'
export type TelemetryError = 'none' | 'network' | 'timeout' | 'restricted' | 'rate_limited' | 'invalid_response' | 'cancelled' | 'other'
export type QuickApplyTelemetryError = TelemetryError | 'needs_input' | 'login_required' | 'draft_exists' | 'expired'
export type DurationBucket = 'under_100ms' | '100_500ms' | '500ms_2s' | '2_10s' | 'over_10s'
export type WatchSlotBucket = '10s' | '20s' | '40s' | '80s_plus'
export type UiSurface = 'projects' | 'saved' | 'filters' | 'preview' | 'detail' | 'proposal' | 'settings'
export const UI_SURFACES: readonly UiSurface[] = ['projects', 'saved', 'filters', 'preview', 'detail', 'proposal', 'settings']
export type MonitoringSummary = Partial<Record<`${SourceId}_${'success' | 'failure' | 'cooldown' | 'paused' | 'disabled'}`, number>>
export type NotificationSummary = Partial<Record<`${SourceId}_${'requested' | 'shown' | 'failed' | 'activated'}`, number>>
export type WatchHourlySummary = Partial<Record<`${WatchSource}_${'ok' | 'blocked' | 'failed' | 'slowed' | 'preempted'}`, number> & Record<`${WatchSource}_slot`, WatchSlotBucket>>
export interface TelemetryEvents {
  analytics_enrolled: { disclosure: typeof TELEMETRY_DISCLOSURE }
  started: { launch_kind: 'normal' | 'notification' }
  active_daily: { activity_kind: 'interface' | 'monitoring' }
  version_first_seen: { transition: 'first_observed' | 'upgrade' | 'downgrade'; previous_version?: string }
  monitoring_hourly: MonitoringSummary
  notification_summary: NotificationSummary
  watch_hourly: WatchHourlySummary
  project_open_result: { source: SourceId | 'unknown'; entry: 'notification' | 'app' | 'watch_notification'; launch: 'accepted' | 'failed' | 'unknown'; foreground: 'confirmed' | 'denied' | 'target-unknown' | 'not-attempted'; duration: DurationBucket }
  quick_apply_result: { source: 'mostaql' | 'nafezly'; outcome: TelemetryOutcome; error: QuickApplyTelemetryError; duration: DurationBucket }
  proposal_result: { provider: 'gemini' | 'openai' | 'anthropic'; outcome: TelemetryOutcome; error: TelemetryError; duration: DurationBucket }
  feature_used: { feature: 'bookmark' | 'saved_filter' | 'backup_created' | 'restore_requested'; outcome: TelemetryOutcome }
  update_download_result: { target_version: string; outcome: TelemetryOutcome; error: TelemetryError }
  watch_started: { source: WatchSource; entry: 'list' | 'preview' | 'detail' | 'compact' | 'watch_view' | 'auto_submitted'; result: 'active' | 'waiting' | 'replaced_other' }
  watch_daily: { source: WatchSource; watched: '0' | '1_2' | '3_5' | '6_10'; waiting: '0' | '1_2' | '3_plus' }
  watch_change: { source: WatchSource; change: 'contact_sure' | 'contact_maybe' | 'status_in_progress' | 'status_closed'; notified: 'sent' | 'failed' | 'suppressed' | 'batched' }
  watch_stopped: { source: WatchSource; reason: 'manual' | 'replaced' | 'closed' | 'expired' | 'ignored' | 'gone' | 'source_disabled' }
}
export type TelemetryName = keyof TelemetryEvents
export interface TelemetryEnvelope {
  eventId: string
  name: TelemetryName
  occurredAt: string
  distinctId: string
  schemaVersion: 1
  environment: 'production' | 'qa'
  appVersion: string
  language: 'ar' | 'en'
  windowsFamily: '10' | '11' | 'other'
  count: number
  properties: Record<string, string | number>
}
export interface AnalyticsStatus {
  /** Configured distributions require acceptance; transport outages do not revoke it. */
  accessAllowed: boolean
  purgePending: boolean
  available: boolean
  state: 'unknown' | 'enabled' | 'disabled'
  disclosure: string
  reference: string | null
  prompted: boolean
  queued: number
  transport: 'idle' | 'sending' | 'retrying' | 'rejected' | 'unavailable'
  lastAcceptedAt: string | null
  dropped: number
}
const oneOf = (...values: readonly string[]) => (v: unknown): boolean => typeof v === 'string' && values.includes(v)
const counter = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000
export const telemetryVersion = (v: unknown): v is string => typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9.-]{1,30})?$/.test(v)
export const telemetryUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)
const outcome = oneOf('success', 'failed', 'cancelled')
const error = oneOf('none', 'network', 'timeout', 'restricted', 'rate_limited', 'invalid_response', 'cancelled', 'other')
const duration = oneOf('under_100ms', '100_500ms', '500ms_2s', '2_10s', 'over_10s')
const watchSource = oneOf(...WATCH_TELEMETRY_SOURCES)
const slotBucket = oneOf('10s', '20s', '40s', '80s_plus')
type Rules = Record<string, (v: unknown) => boolean>
const summaryRules = (kinds: string[]): Rules => Object.fromEntries(TELEMETRY_SOURCES.flatMap(source => kinds.map(kind => [`${source}_${kind}`, counter])))
const watchSummaryRules = (): Rules => {
  const entries: [string, (v: unknown) => boolean][] = []
  for (const source of WATCH_TELEMETRY_SOURCES) {
    for (const kind of ['ok', 'blocked', 'failed', 'slowed', 'preempted'] as const) {
      entries.push([`${source}_${kind}`, counter])
    }
    entries.push([`${source}_slot`, slotBucket])
  }
  return Object.fromEntries(entries)
}
const rules: Record<TelemetryName, Rules> = {
  analytics_enrolled: { disclosure: oneOf(TELEMETRY_DISCLOSURE) },
  started: { launch_kind: oneOf('normal', 'notification') },
  active_daily: { activity_kind: oneOf('interface', 'monitoring') },
  version_first_seen: { transition: oneOf('first_observed', 'upgrade', 'downgrade'), previous_version: telemetryVersion },
  monitoring_hourly: summaryRules(['success', 'failure', 'cooldown', 'paused', 'disabled']),
  notification_summary: summaryRules(['requested', 'shown', 'failed', 'activated']),
  watch_hourly: watchSummaryRules(),
  project_open_result: { source: oneOf(...TELEMETRY_SOURCES, 'unknown'), entry: oneOf('notification', 'app', 'watch_notification'), launch: oneOf('accepted', 'failed', 'unknown'), foreground: oneOf('confirmed', 'denied', 'target-unknown', 'not-attempted'), duration },
  quick_apply_result: { source: oneOf('mostaql', 'nafezly'), outcome, error: v => error(v) || oneOf('needs_input', 'login_required', 'draft_exists', 'expired')(v), duration },
  proposal_result: { provider: oneOf('gemini', 'openai', 'anthropic'), outcome, error, duration },
  feature_used: { feature: oneOf('bookmark', 'saved_filter', 'backup_created', 'restore_requested'), outcome },
  update_download_result: { target_version: telemetryVersion, outcome, error },
  watch_started: { source: watchSource, entry: oneOf('list', 'preview', 'detail', 'compact', 'watch_view', 'auto_submitted'), result: oneOf('active', 'waiting', 'replaced_other') },
  watch_daily: { source: watchSource, watched: oneOf('0', '1_2', '3_5', '6_10'), waiting: oneOf('0', '1_2', '3_plus') },
  watch_change: { source: watchSource, change: oneOf('contact_sure', 'contact_maybe', 'status_in_progress', 'status_closed'), notified: oneOf('sent', 'failed', 'suppressed', 'batched') },
  watch_stopped: { source: watchSource, reason: oneOf('manual', 'replaced', 'closed', 'expired', 'ignored', 'gone', 'source_disabled') }
}
export function validTelemetryProperties(name: unknown, value: unknown): value is Record<string, string | number> {
  if (typeof name !== 'string' || !Object.hasOwn(rules, name) || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const spec = rules[name as TelemetryName], entries = Object.entries(value)
  if (!entries.length || entries.length > 24 || entries.some(([key, v]) => !Object.hasOwn(spec, key) || !spec[key]!(v))) return false
  if ((TELEMETRY_SUMMARIES as readonly string[]).includes(name)) return true
  return Object.keys(spec).every(key => key === 'previous_version' || Object.hasOwn(value, key))
}
export function validTelemetryEnvelope(value: unknown): value is TelemetryEnvelope {
  if (!value || typeof value !== 'object') return false
  const e = value as TelemetryEnvelope
  const keys = ['eventId', 'name', 'occurredAt', 'distinctId', 'schemaVersion', 'environment', 'appVersion', 'language', 'windowsFamily', 'count', 'properties']
  return Object.keys(e).length === keys.length && Object.keys(e).every(k => keys.includes(k)) && telemetryUuid(e.eventId) && telemetryUuid(e.distinctId) && e.schemaVersion === 1 && oneOf('production', 'qa')(e.environment) && telemetryVersion(e.appVersion) && oneOf('ar', 'en')(e.language) && oneOf('10', '11', 'other')(e.windowsFamily) && typeof e.occurredAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(e.occurredAt) && Number.isFinite(Date.parse(e.occurredAt)) && counter(e.count) && e.count > 0 && validTelemetryProperties(e.name, e.properties)
}
export function durationBucket(ms: number): DurationBucket {
  return ms < 100 ? 'under_100ms' : ms < 500 ? '100_500ms' : ms < 2000 ? '500ms_2s' : ms < 10000 ? '2_10s' : 'over_10s'
}
export function watchSlotBucket(ms: number): WatchSlotBucket {
  return ms <= 10000 ? '10s' : ms <= 20000 ? '20s' : ms <= 40000 ? '40s' : '80s_plus'
}
export function watchDailyBuckets(watched: number, waiting: number): { watched: '0' | '1_2' | '3_5' | '6_10'; waiting: '0' | '1_2' | '3_plus' } {
  const w = (!Number.isInteger(watched) || watched < 0) ? 0 : watched
  const wt = (!Number.isInteger(waiting) || waiting < 0) ? 0 : waiting
  return {
    watched: w === 0 ? '0' : w <= 2 ? '1_2' : w <= 5 ? '3_5' : '6_10',
    waiting: wt === 0 ? '0' : wt <= 2 ? '1_2' : '3_plus'
  }
}
export function telemetryError(value: string | undefined): TelemetryError {
  if (!value) return 'none'
  if (/cancel|abort/.test(value)) return 'cancelled'
  if (/timeout/.test(value)) return 'timeout'
  if (/429|rate|quota/.test(value)) return 'rate_limited'
  if (/403|401|forbidden|auth|key|permission/.test(value)) return 'restricted'
  if (/network|offline|fetch|connect/.test(value)) return 'network'
  if (/invalid|response|json|content|parse/.test(value)) return 'invalid_response'
  return 'other'
}
export function quickApplyTelemetryError(phase: string, message?: string): QuickApplyTelemetryError {
  if (phase === 'needs-input') return 'needs_input'
  if (phase === 'needs-login') return 'login_required'
  if (phase === 'draft-exists') return 'draft_exists'
  if (phase === 'expired') return 'expired'
  return telemetryError(message ?? (phase === 'ready' ? undefined : phase))
}
