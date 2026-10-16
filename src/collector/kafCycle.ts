import type { Db } from '../storage/db.js'
import { createPendingEvents, filterOutTombstoned, getProjectById, getSettingRaw, getSourceState, recordDiagnostic, runInTransaction, saveSourceState, setSettingRaw, upsertProjectsBatch } from '../storage/repositories.js'
import { updateKafListMetadata } from '../storage/kaf.js'
import type { AppSettings } from '../shared/types.js'
import { matchesKafKeywords, type KafItem } from './kaf.js'
import { recordMonitoringSuccess } from '../storage/monitoring.js'

export interface KafCheckpoint { anchorIds: string[]; cursor: number }
export function applyKafCycle(db: Db, items: KafItem[], opts: { firstPageIds: string[]; checkpoint: KafCheckpoint | null; coverageComplete?: boolean; nowMs: number; durationMs: number; runId: string; settings: AppSettings }): { insertedIds: number[]; updatedIds: number[]; notifyIds: number[] } {
  const previous = getSourceState(db, 'kaf'), now = new Date(opts.nowMs).toISOString()
  const first = !previous.baselineComplete
  const storedCheckpoint = getSettingRaw(db, 'kaf:checkpoint')
  const recovered = !first && (opts.checkpoint !== null || !!storedCheckpoint && storedCheckpoint !== 'null' || !previous.lastSuccessAt || opts.nowMs - Date.parse(previous.lastSuccessAt) > 60000)
  return runInTransaction(db, () => {
    const unique = [...new Map(items.map(item => [item.externalId, item])).values()]
    // Preserve a detail-page timestamp without assigning it an assumed timezone.
    const input = unique.map(item => {
      const row = db.prepare("SELECT published_raw FROM projects WHERE source='kaf' AND external_id=?").get(item.externalId) as { published_raw: string | null } | undefined
      return row?.published_raw && /^\d{4}-\d{2}-\d{2} /.test(row.published_raw) ? { ...item, publishedRaw: row.published_raw } : item
    })
    const batch = upsertProjectsBatch(db, filterOutTombstoned(db, input), { now, discoveryKind: first ? 'initial' : recovered ? 'recovered' : 'live' })
    const find = db.prepare("SELECT id FROM projects WHERE source='kaf' AND external_id=?")
    for (const item of unique) { const row = find.get(item.externalId) as { id: number } | undefined; if (row) updateKafListMetadata(db, row.id, item) }
    const byId = new Map(unique.map(item => [item.externalId, item]))
    const notifyIds = batch.insertedIds.filter(id => {
      const p = getProjectById(db, id), item = p ? byId.get(p.externalId) : null
      const s = opts.settings
      return !first && !recovered && !!item && item.platformStatus === 'open' && s.kafEnabled && s.notificationsEnabled && s.kafNotificationsEnabled &&
        (!s.doNotDisturbUntil || Date.parse(s.doNotDisturbUntil) <= opts.nowMs) && matchesKafKeywords(item.title, item.descriptionExcerpt, s.kafKeywordsAny, s.kafExcludeKeywords)
    })
    if (notifyIds.length) createPendingEvents(db, notifyIds, 'new_project', now)
    setSettingRaw(db, 'kaf:last-list-ids', JSON.stringify(opts.firstPageIds))
    setSettingRaw(db, 'kaf:checkpoint', JSON.stringify(opts.checkpoint))
    recordMonitoringSuccess(db, 'kaf', opts.firstPageIds, batch.insertedIds.length, now, { recoveredAll: opts.coverageComplete })
    saveSourceState(db, { ...previous, baselineComplete: true, lastSuccessAt: now, lastAttemptAt: now, lastError: opts.checkpoint ? 'catch-up-incomplete' : null,
      consecutiveFailures: 0, backoffUntil: null, transportKind: 'html-fragment', runId: opts.runId })
    recordDiagnostic(db, { at: now, endpointKind: 'kaf-list', status: first ? 'ok-baseline' : opts.checkpoint ? 'catch-up-incomplete' : 'ok', durationMs: opts.durationMs, itemCount: unique.length, errorCategory: null,
      detail: `inserted=${batch.insertedIds.length}; alerts=${notifyIds.length}; cursor=${opts.checkpoint?.cursor ?? 0}` })
    // Metadata changes (including closed status) must refresh already visible cards.
    const changed = unique.map(item => find.get(item.externalId) as { id: number } | undefined).filter((row): row is { id: number } => !!row).map(row => row.id)
    return { ...batch, updatedIds: [...new Set([...batch.updatedIds, ...changed])], notifyIds }
  })
}
