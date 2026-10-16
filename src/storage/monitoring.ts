import type { Db } from './db.js'
import { getSettingRaw, getSourceState, setSettingRaw } from './repositories.js'
import type { SourceId } from '../shared/sources.js'
import type { SourceHealth } from '../shared/types.js'

interface MonitoringRecord {
  ids: string[]
  lastDiscoveryAt: string | null
  gap: NonNullable<SourceHealth['coverageGap']> | null
}
const key = (source: SourceId): string => `monitoring:${source}`
export function readMonitoring(db: Db, source: SourceId): MonitoringRecord {
  try {
    const value = JSON.parse(getSettingRaw(db, key(source)) ?? 'null') as MonitoringRecord | null
    if (value && Array.isArray(value.ids) && value.ids.every(id => typeof id === 'string') && (value.lastDiscoveryAt === null || typeof value.lastDiscoveryAt === 'string') && (value.gap === null || value.gap && ['no-overlap', 'interrupted'].includes(value.gap.reason) && typeof value.gap.detectedAt === 'string' && typeof value.gap.since === 'string')) return value
  } catch { /* Missing/old metadata is initialized by the next successful poll. */ }
  return { ids: [], lastDiscoveryAt: null, gap: null }
}

/** Called inside each discovery transaction, before source_state advances. */
export function recordMonitoringSuccess(db: Db, source: SourceId, ids: string[], inserted: number, now: string, opts: { recoveredAll?: boolean; previousIds?: string[] } = {}): void {
  const state = getSourceState(db, source), previous = readMonitoring(db, source)
  const oldIds = previous.ids.length ? previous.ids : opts.previousIds ?? []
  const noOverlap = oldIds.length > 0 && ids.length > 0 && !ids.some(id => oldIds.includes(id))
  const interrupted = state.lastSuccessAt && Date.parse(now) - Date.parse(state.lastSuccessAt) > 120_000
  // An unresolved warning survives later successful overlapping polls and restart.
  // Completing a paginated KAF catch-up is a different, explicitly recoverable case.
  let gap = previous.gap
  if (state.baselineComplete && !gap && !opts.recoveredAll && (noOverlap || interrupted)) {
    gap = { since: state.lastSuccessAt ?? now, detectedAt: now, reason: noOverlap ? 'no-overlap' : 'interrupted' }
  }
  if (opts.recoveredAll) gap = null
  setSettingRaw(db, key(source), JSON.stringify({ ids: [...new Set(ids)].slice(0, 1000), lastDiscoveryAt: inserted > 0 ? now : previous.lastDiscoveryAt, gap }))
}

export function acknowledgeMonitoringGap(db: Db, source: SourceId): void {
  const previous = readMonitoring(db, source)
  setSettingRaw(db, key(source), JSON.stringify({ ...previous, gap: null }))
}

export function monitoringFields(db: Db | null, source: SourceId): Pick<SourceHealth, 'lastDiscoveryAt' | 'coverageGap' | 'recovering'> {
  const meta = db ? readMonitoring(db, source) : null
  return { lastDiscoveryAt: meta?.lastDiscoveryAt ?? null, coverageGap: meta?.gap ?? null, recovering: !!db && source === 'kaf' && ![null, 'null'].includes(getSettingRaw(db, 'kaf:checkpoint')) }
}
