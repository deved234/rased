import type { SourceId } from './sources.js'

export const TELEMETRY_DISCLOSURE = '2026-10-19-v2'
export const ANALYTICS_SUPPORT = 'https://wa.me/201201780258'
export const TELEMETRY_SOURCES = ['mostaql', 'khamsat', 'nafezly', 'kaf'] as const
export type TelemetryOutcome = 'success' | 'failed' | 'cancelled'
export type TelemetryError = 'none' | 'network' | 'timeout' | 'restricted' | 'rate_limited' | 'invalid_response' | 'cancelled' | 'other'
export type QuickApplyTelemetryError = TelemetryError | 'needs_input' | 'login_required' | 'draft_exists' | 'expired'
export type DurationBucket = 'under_100ms' | '100_500ms' | '500ms_2s' | '2_10s' | 'over_10s'
export type UiSurface = 'projects' | 'saved' | 'filters' | 'preview' | 'detail' | 'proposal' | 'settings'
export const UI_SURFACES: readonly UiSurface[] = ['projects', 'saved', 'filters', 'preview', 'detail', 'proposal', 'settings']
export type MonitoringSummary = Partial<Record<`${SourceId}_${'success' | 'failure' | 'cooldown' | 'paused' | 'disabled'}`, number>>
export type NotificationSummary = Partial<Record<`${SourceId}_${'requested' | 'shown' | 'failed' | 'activated'}`, number>>
export interface TelemetryEvents {
  analytics_enrolled: { disclosure: typeof TELEMETRY_DISCLOSURE }
  started: { launch_kind: 'normal' | 'notification' }
  active_daily: { activity_kind: 'interface' | 'monitoring' }
  version_first_seen: { transition: 'first_observed' | 'upgrade' | 'downgrade'; previous_version?: string }
  monitoring_hourly: MonitoringSummary
  notification_summary: NotificationSummary
  project_open_result: { source: SourceId | 'unknown'; entry: 'notification' | 'app'; launch: 'accepted' | 'failed' | 'unknown'; foreground: 'confirmed' | 'denied' | 'target-unknown' | 'not-attempted'; duration: DurationBucket }
  quick_apply_result: { source: 'mostaql' | 'nafezly'; outcome: TelemetryOutcome; error: QuickApplyTelemetryError; duration: DurationBucket }
  proposal_result: { provider: 'gemini' | 'openai' | 'anthropic'; outcome: TelemetryOutcome; error: TelemetryError; duration: DurationBucket }
  feature_used: { feature: 'bookmark' | 'saved_filter' | 'backup_created' | 'restore_requested'; outcome: TelemetryOutcome }
  update_download_result: { target_version: string; outcome: TelemetryOutcome; error: TelemetryError }
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
type Rules = Record<string, (v: unknown) => boolean>
const summaryRules = (kinds: string[]): Rules => Object.fromEntries(TELEMETRY_SOURCES.flatMap(source => kinds.map(kind => [`${source}_${kind}`, counter])))
const rules: Record<TelemetryName, Rules> = {
  analytics_enrolled: { disclosure: oneOf(TELEMETRY_DISCLOSURE) },
  started: { launch_kind: oneOf('normal', 'notification') },
  active_daily: { activity_kind: oneOf('interface', 'monitoring') },
  version_first_seen: { transition: oneOf('first_observed', 'upgrade', 'downgrade'), previous_version: telemetryVersion },
  monitoring_hourly: summaryRules(['success', 'failure', 'cooldown', 'paused', 'disabled']),
  notification_summary: summaryRules(['requested', 'shown', 'failed', 'activated']),
  project_open_result: { source: oneOf(...TELEMETRY_SOURCES, 'unknown'), entry: oneOf('notification', 'app'), launch: oneOf('accepted', 'failed', 'unknown'), foreground: oneOf('confirmed', 'denied', 'target-unknown', 'not-attempted'), duration },
  quick_apply_result: { source: oneOf('mostaql', 'nafezly'), outcome, error: v => error(v) || oneOf('needs_input', 'login_required', 'draft_exists', 'expired')(v), duration },
  proposal_result: { provider: oneOf('gemini', 'openai', 'anthropic'), outcome, error, duration },
  feature_used: { feature: oneOf('bookmark', 'saved_filter', 'backup_created', 'restore_requested'), outcome },
  update_download_result: { target_version: telemetryVersion, outcome, error }
}
export function validTelemetryProperties(name: unknown, value: unknown): value is Record<string, string | number> {
  if (typeof name !== 'string' || !Object.hasOwn(rules, name) || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const spec = rules[name as TelemetryName], entries = Object.entries(value)
  if (!entries.length || entries.length > 24 || entries.some(([key, v]) => !Object.hasOwn(spec, key) || !spec[key]!(v))) return false
  if (name === 'monitoring_hourly' || name === 'notification_summary') return true
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
