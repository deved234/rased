import type { SourceHealth } from './types.js'
import type { SourceId } from './sources.js'

export type MonitoringIssue = 'network' | 'timeout' | 'restricted' | 'rate-limited' | 'content' | 'server' | 'unknown'

export function transportIssueCode(result: { ok: boolean; status: number | null; error?: string }): string {
  if (result.status !== null && (result.status >= 400 || result.status === 202)) return `http-${result.status}`
  if (result.ok) return 'invalid_content'
  if (result.status !== null) return 'invalid_content'
  return /abort|timeout/i.test(result.error ?? '') ? 'timeout' : 'network'
}

/** Classify old and new collector errors without exposing raw responses to the UI. */
export function monitoringIssue(error: string | null): MonitoringIssue | null {
  if (!error || error === 'catch-up-incomplete') return null
  if (/429|rate.?limit/i.test(error)) return 'rate-limited'
  if (/forbidden|401|403|202|challenge|protection/i.test(error)) return 'restricted'
  if (/timeout|timed.?out|abort/i.test(error)) return 'timeout'
  if (/network|fetch failed|ENOTFOUND|ECONN|offline/i.test(error)) return 'network'
  if (/http.?5\d\d|server/i.test(error)) return 'server'
  if (/invalid|parse|content|too.large|empty|zero|unexpected|missing/i.test(error)) return 'content'
  return 'unknown'
}

export function monitoringState(input: { enabled: boolean; paused: boolean; backoffUntil: number; lastError: string | null; lastSuccessAt: string | null; failures: number }, now: number): SourceHealth['state'] {
  if (!input.enabled) return 'disabled'
  if (input.paused) return 'paused'
  const issue = monitoringIssue(input.lastError)
  if (issue === 'restricted') return 'needs-review'
  if (input.backoffUntil > now) return 'backing-off'
  if ((issue === 'network' || issue === 'timeout') && input.failures >= 2) return 'offline'
  if (issue) return 'error'
  return input.lastSuccessAt ? 'watching' : 'initializing'
}

/** Intentionally omit raw errors, endpoints, diagnostics, titles, paths and user settings. */
export function monitoringReport(version: string, sources: { id: SourceId; health: SourceHealth }[], now = new Date().toISOString()): string {
  return JSON.stringify({ app: 'RASED', version, generatedAt: now, sources: sources.map(({ id, health: h }) => ({
    id, enabled: h.enabled !== false, state: h.state, temporarilyPaused: h.paused,
    checking: h.checking === true, lastAttemptAt: h.lastAttemptAt, lastSuccessAt: h.lastSuccessAt,
    lastDiscoveryAt: h.lastDiscoveryAt ?? null, nextAttemptAt: h.nextAttemptAt,
    issue: monitoringIssue(h.lastError), consecutiveFailures: h.consecutiveFailures,
    effectiveIntervalMs: h.effectiveIntervalMs, lastDurationMs: h.lastDurationMs,
    lastItemCount: h.lastItemCount, recovering: h.recovering === true, coverageGap: h.coverageGap ?? null
  })) }, null, 2)
}
