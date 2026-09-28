import type { Db } from '../storage/db.js'
import { createPendingEvents, filterOutTombstoned, getProjectById, getSourceState, recordDiagnostic, runInTransaction, saveSourceState, upsertProjectsBatch, type UpsertInput } from '../storage/repositories.js'
import type { AppSettings } from '../shared/types.js'
import { isFreshKhamsatRequest, KHAMSAT_SOURCE, matchesKhamsatKeywords } from './khamsat.js'

export function applyKhamsatCycle(db: Db, items: UpsertInput[], context: { nowMs: number; runId: string; durationMs: number; settings: AppSettings }): { insertedIds: number[]; updatedIds: number[]; notifyIds: number[] } {
  const nowIso = new Date(context.nowMs).toISOString()
  const previous = getSourceState(db, KHAMSAT_SOURCE)
  return runInTransaction(db, () => {
    const first = !previous.baselineComplete
    const batch = upsertProjectsBatch(db, filterOutTombstoned(db, items), { now: nowIso, discoveryKind: first ? 'initial' : 'live' })
    const notifyIds: number[] = []
    for (const id of batch.insertedIds) {
      const project = getProjectById(db, id)
      if (!project || !isFreshKhamsatRequest(project.publishedAt, previous.lastSuccessAt, context.nowMs)) {
        if (!first) db.prepare("UPDATE projects SET discovery_kind = 'recovered' WHERE id = ?").run(id)
        continue
      }
      if (context.settings.notificationsEnabled && context.settings.khamsatNotificationsEnabled && matchesKhamsatKeywords(project.title, context.settings.khamsatKeywordsAny, context.settings.khamsatExcludeKeywords)) notifyIds.push(id)
    }
    if (notifyIds.length) createPendingEvents(db, notifyIds, 'new_project', nowIso)
    saveSourceState(db, { ...previous, baselineComplete: true, lastSuccessAt: nowIso, lastAttemptAt: nowIso, lastError: null, consecutiveFailures: 0, backoffUntil: null, transportKind: 'html', runId: context.runId })
    recordDiagnostic(db, { at: nowIso, endpointKind: 'khamsat-list', status: first ? 'ok-baseline' : 'ok', durationMs: context.durationMs, itemCount: items.length, errorCategory: null, detail: `inserted=${batch.insertedIds.length}; alerts=${notifyIds.length}` })
    return { ...batch, notifyIds }
  })
}
