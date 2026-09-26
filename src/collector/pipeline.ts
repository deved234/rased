// Discovery pipeline: baseline, dedup, recovered-vs-live, notification
// evaluation. Runs inside SQLite transactions; pure apart from the Db handle.

import type { Db } from '../storage/db.js'
import {
  createPendingEvents,
  filterOutTombstoned,
  getSourceState,
  getUserState,
  runInTransaction,
  saveClassificationWaits,
  saveSourceState,
  upsertProjectsBatch,
  recordDiagnostic,
  getProjectById
} from '../storage/repositories.js'
import type { NormalizedItem } from './normalize.js'
import { SOURCE } from './normalize.js'
import { evaluateFilter, toFilterable } from '../shared/filters.js'
import type { AppSettings } from '../shared/types.js'
import { RECOVER_GAP_MS } from './scheduler.js'

export interface CycleContext {
  nowIso: string
  nowMs: number
  runId: string
  /** true when this cycle follows a restart or a long gap */
  recovering: boolean
  settings: AppSettings
  durationMs: number
  itemCount: number
  invalidSingles: number
}

export interface CycleOutcome {
  insertedIds: number[]
  updatedIds: number[]
  baseline: boolean
  recovering: boolean
  /** new projects eligible for notification (pending events created) */
  notifyProjectIds: number[]
  /** uncertain-category projects waiting on enrichment (projectId -> deadlineMs) */
  uncertainWaits: Map<number, number>
  /** new match/uncertain projects that should be enriched for filters/display */
  enrichIds: number[]
}

function isRecovering(lastSuccessAt: string | null, nowMs: number, firstCycleOfRun: boolean): boolean {
  if (firstCycleOfRun && lastSuccessAt !== null) return true
  if (!lastSuccessAt) return false
  const last = Date.parse(lastSuccessAt)
  if (Number.isNaN(last)) return true
  return nowMs - last > RECOVER_GAP_MS
}

export function applySuccessfulCycle(
  db: Db,
  items: NormalizedItem[],
  ctx: Omit<CycleContext, 'recovering'> & { firstCycleOfRun: boolean }
): CycleOutcome {
  const state = getSourceState(db, SOURCE)
  const recovering = isRecovering(state.lastSuccessAt, ctx.nowMs, ctx.firstCycleOfRun)

  if (!state.baselineComplete) {
    return runInTransaction(db, () => {
      const live = filterOutTombstoned(db, items)
      const { insertedIds } = upsertProjectsBatch(db, live, { now: ctx.nowIso, discoveryKind: 'initial' })
      saveSourceState(db, {
        ...state,
        baselineComplete: true,
        lastSuccessAt: ctx.nowIso,
        lastAttemptAt: ctx.nowIso,
        lastError: null,
        consecutiveFailures: 0,
        backoffUntil: null,
        transportKind: 'rss',
        runId: ctx.runId
      })
      recordDiagnostic(db, {
        at: ctx.nowIso,
        endpointKind: 'rss',
        status: 'ok-baseline',
        durationMs: ctx.durationMs,
        itemCount: ctx.itemCount,
        errorCategory: null,
        detail: ctx.invalidSingles > 0 ? `${ctx.invalidSingles} invalid singles isolated` : null
      })
      return {
        insertedIds,
        updatedIds: [],
        baseline: true,
        recovering: false,
        notifyProjectIds: [],
        uncertainWaits: new Map(),
        enrichIds: []
      }
    })
  }

  return runInTransaction(db, () => {
    const kind = recovering ? 'recovered' : 'live'
    const live = filterOutTombstoned(db, items)
    const { insertedIds, updatedIds } = upsertProjectsBatch(db, live, { now: ctx.nowIso, discoveryKind: kind })
    const notifyProjectIds: number[] = []
    const uncertainWaits = new Map<number, number>()
    const enrichIds: number[] = []
    const s = ctx.settings

    if (s.notificationsEnabled) {
      for (const pid of insertedIds) {
        const p = getProjectById(db, pid)
        if (!p) continue
        const verdict = evaluateFilter(toFilterable(p), s.notifyFilter)
        if (verdict === 'match') {
          notifyProjectIds.push(pid)
          enrichIds.push(pid)
        } else if (verdict === 'uncertain') {
          uncertainWaits.set(pid, ctx.nowMs + 30_000)
          enrichIds.push(pid)
        }
      }
      if (notifyProjectIds.length > 0) createPendingEvents(db, notifyProjectIds, 'new_project', ctx.nowIso)
      saveClassificationWaits(db, uncertainWaits)
    } else {
      // Notifications off: still enrich fresh items lightly so the list is useful.
      for (const pid of insertedIds.slice(0, 10)) enrichIds.push(pid)
    }

    saveSourceState(db, {
      ...state,
      lastSuccessAt: ctx.nowIso,
      lastAttemptAt: ctx.nowIso,
      lastError: null,
      consecutiveFailures: 0,
      backoffUntil: null,
      transportKind: 'rss',
      runId: ctx.runId
    })
    recordDiagnostic(db, {
      at: ctx.nowIso,
      endpointKind: 'rss',
      status: recovering ? 'ok-recovered' : 'ok',
      durationMs: ctx.durationMs,
      itemCount: ctx.itemCount,
      errorCategory: null,
      detail: ctx.invalidSingles > 0 ? `${ctx.invalidSingles} invalid singles isolated` : null
    })
    return { insertedIds, updatedIds, baseline: false, recovering, notifyProjectIds, uncertainWaits, enrichIds }
  })
}

export function applyFailedCycle(
  db: Db,
  opts: { nowIso: string; errorCategory: string; detail: string | null; durationMs: number; runId: string }
): void {
  runInTransaction(db, () => {
    const state = getSourceState(db, SOURCE)
    saveSourceState(db, {
      ...state,
      lastAttemptAt: opts.nowIso,
      lastError: opts.errorCategory,
      consecutiveFailures: state.consecutiveFailures + 1,
      transportKind: 'rss',
      runId: opts.runId
    })
    recordDiagnostic(db, {
      at: opts.nowIso,
      endpointKind: 'rss',
      status: 'failed',
      durationMs: opts.durationMs,
      itemCount: null,
      errorCategory: opts.errorCategory,
      detail: opts.detail
    })
  })
}

/** Late classification: re-evaluate current notify rules once details land. */
export function evaluateLateProject(
  db: Db,
  projectId: number,
  settings: AppSettings,
  nowIso: string
): 'notify' | 'silent' {
  const p = getProjectById(db, projectId)
  if (!p || !settings.notificationsEnabled) return 'silent'
  // Hidden projects never notify at re-evaluation; the pending event (if any)
  // is suppressed at dispatch instead of deleted.
  if (getUserState(db, projectId).hiddenAt !== null) return 'silent'
  const verdict = evaluateFilter(toFilterable(p), settings.notifyFilter)
  if (verdict === 'match') {
    createPendingEvents(db, [projectId], 'new_project', nowIso)
    return 'notify'
  }
  return 'silent'
}
