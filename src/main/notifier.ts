// Notification dispatch with crash-safe states.
// pending -> dispatching (persisted BEFORE calling the OS) -> submitted/failed.
// Boot marks other sessions' dispatching rows 'uncertain' — never auto-resent.
// Electron-free: the OS sender is injected, so this is fully unit-testable.

import type { Db } from '../storage/db.js'
import {
  getEventsByIds,
  getProjectById,
  hasBatch,
  listEventsByStatus,
  markEvents,
  markStaleDispatchingUncertain,
  recordBatch,
  transitionToDispatching
} from '../storage/repositories.js'
import type { Project } from '../shared/types.js'

export const BATCH_THRESHOLD = 5

export interface SinglePayload {
  eventId: number
  project: Project
  uncertain: boolean
}

export interface SummaryPayload {
  eventIds: number[]
  projects: Project[]
  recovering: boolean
}

export interface DispatchDeps {
  /** show one toast; resolves true when the OS accepted it */
  sendSingle: (p: SinglePayload) => Promise<boolean>
  sendSummary: (p: SummaryPayload) => Promise<boolean>
  onBeep?: () => void
  shouldSend?: (project: Project) => boolean
}

export interface DispatchOutcome {
  singles: number
  summaries: number
  failed: number
  skipped: number
}

export function recoverPreviousSession(db: Db, sessionId: string, nowIso: string): number {
  return markStaleDispatchingUncertain(db, sessionId, nowIso)
}

export async function dispatchPending(
  db: Db,
  opts: { sessionId: string; nowIso: string; recovering: boolean; batchKey: string | null },
  deps: DispatchDeps
): Promise<DispatchOutcome> {
  const out: DispatchOutcome = { singles: 0, summaries: 0, failed: 0, skipped: 0 }
  const pending = listEventsByStatus(db, 'pending')
  if (pending.length === 0) return out

  const withProjects: { eventId: number; project: Project }[] = []
  const orphaned: number[] = []
  const suppressed: number[] = []
  for (const e of getEventsByIds(db, pending.map((p) => p.id))) {
    const p = getProjectById(db, e.project_id)
    if (p && deps.shouldSend && !deps.shouldSend(p)) suppressed.push(e.id)
    else if (p) withProjects.push({ eventId: e.id, project: p })
    else orphaned.push(e.id)
  }
  if (suppressed.length > 0) {
    markEvents(db, suppressed, 'suppressed', null, opts.nowIso)
    out.skipped += suppressed.length
  }
  if (orphaned.length > 0) {
    markEvents(db, orphaned, 'failed', null, opts.nowIso)
    out.failed += orphaned.length
  }
  if (withProjects.length === 0) return out

  const useSummary =
    withProjects.length > BATCH_THRESHOLD || (opts.recovering && withProjects.length > 1)
  if (useSummary) {
    const batchKey = opts.batchKey ?? `batch:${opts.nowIso}`
    if (opts.batchKey && hasBatch(db, opts.batchKey)) {
      // Same catch-up batch already summarized in a previous run: stay silent,
      // keep events submitted so the list (not toasts) carries the history.
      const ids = withProjects.map((w) => w.eventId)
      transitionToDispatching(db, ids, opts.sessionId, opts.nowIso)
      markEvents(db, ids, 'submitted', opts.batchKey, opts.nowIso)
      out.skipped += ids.length
      return out
    }
    const ids = withProjects.map((w) => w.eventId)
    transitionToDispatching(db, ids, opts.sessionId, opts.nowIso)
    const ok = await deps.sendSummary({
      eventIds: ids,
      projects: withProjects.map((w) => w.project),
      recovering: opts.recovering
    })
    markEvents(db, ids, ok ? 'submitted' : 'failed', batchKey, opts.nowIso)
    recordBatch(db, batchKey, ids.length, opts.nowIso)
    if (ok) {
      out.summaries += 1
      deps.onBeep?.()
    } else {
      out.failed += ids.length
    }
    return out
  }

  for (const w of withProjects) {
    if (deps.shouldSend && !deps.shouldSend(w.project)) {
      markEvents(db, [w.eventId], 'suppressed', null, opts.nowIso)
      out.skipped++
      continue
    }
    transitionToDispatching(db, [w.eventId], opts.sessionId, opts.nowIso)
    const ok = await deps.sendSingle({
      eventId: w.eventId,
      project: w.project,
      uncertain: !w.project.categoryConfirmed
    })
    markEvents(db, [w.eventId], ok ? 'submitted' : 'failed', null, opts.nowIso)
    if (ok) {
      out.singles += 1
      deps.onBeep?.()
    } else {
      out.failed += 1
    }
  }
  return out
}
