import type { Db } from '../storage/db.js'
import { createPendingEvents, filterOutTombstoned, getProjectById, getSettingRaw, getSourceState, recordDiagnostic, runInTransaction, saveSourceState, setSettingRaw, upsertProjectDetails, upsertProjectsBatch } from '../storage/repositories.js'
import type { AppSettings } from '../shared/types.js'
import { matchesNafezlyKeywords, NAFEZLY_SOURCE, type NafezlyItem } from './nafezly.js'

const FEED_IDS_KEY = 'nafezly:last-feed-ids'

export function applyNafezlyCycle(db: Db, items: NafezlyItem[], context: { nowMs: number; runId: string; durationMs: number; settings: AppSettings }): { insertedIds: number[]; updatedIds: number[]; notifyIds: number[]; gapPossible: boolean } {
  const nowIso = new Date(context.nowMs).toISOString()
  const previous = getSourceState(db, NAFEZLY_SOURCE)
  return runInTransaction(db, () => {
    const first = !previous.baselineComplete
    const previousIds = (getSettingRaw(db, FEED_IDS_KEY) ?? '').split(',').filter(x => /^\d+$/.test(x))
    const currentIds = items.map(item => item.externalId)
    const gapPossible = !first && previousIds.length > 0 && !currentIds.some(id => previousIds.includes(id))
    const batch = upsertProjectsBatch(db, filterOutTombstoned(db, items), { now: nowIso, discoveryKind: first ? 'initial' : 'live' })
    const byId = new Map(items.map(item => [item.externalId, item]))
    for (const projectId of [...batch.insertedIds, ...batch.updatedIds]) {
      const project = getProjectById(db, projectId)
      const item = project ? byId.get(project.externalId) : null
      if (item?.fullDescription) upsertProjectDetails(db, projectId, { text: item.fullDescription, provenance: item.descriptionTruncated ? 'truncated' : 'full', fetchedAt: nowIso, status: 'ready', errorCode: null })
    }
    const notifyIds: number[] = []
    const lastSuccessMs = previous.lastSuccessAt ? Date.parse(previous.lastSuccessAt) : NaN
    for (const projectId of batch.insertedIds) {
      const project = getProjectById(db, projectId)
      const item = project ? byId.get(project.externalId) : null
      if (!project || !item) continue
      const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN
      const recent = Number.isFinite(published) && Number.isFinite(lastSuccessMs) && published >= Math.max(lastSuccessMs - 2 * 60_000, context.nowMs - 30 * 60_000) && published <= context.nowMs + 2 * 60_000
      if (first || !recent) {
        if (!first) db.prepare("UPDATE projects SET discovery_kind = 'recovered' WHERE id = ?").run(projectId)
        continue
      }
      if (context.settings.notificationsEnabled && context.settings.nafezlyNotificationsEnabled && matchesNafezlyKeywords(item.title, item.fullDescription, context.settings.nafezlyKeywordsAny, context.settings.nafezlyExcludeKeywords)) notifyIds.push(projectId)
    }
    if (notifyIds.length) createPendingEvents(db, notifyIds, 'new_project', nowIso)
    setSettingRaw(db, FEED_IDS_KEY, currentIds.join(','))
    saveSourceState(db, { ...previous, baselineComplete: true, lastSuccessAt: nowIso, lastAttemptAt: nowIso, lastError: null, consecutiveFailures: 0, backoffUntil: null, transportKind: 'rss', runId: context.runId })
    recordDiagnostic(db, { at: nowIso, endpointKind: 'nafezly-feed', status: first ? 'ok-baseline' : gapPossible ? 'ok-gap-possible' : 'ok', durationMs: context.durationMs, itemCount: items.length, errorCategory: null, detail: `inserted=${batch.insertedIds.length}; alerts=${notifyIds.length}; overlap=${!gapPossible}` })
    return { ...batch, notifyIds, gapPossible }
  })
}
