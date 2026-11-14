import type { Db } from '../storage/db.js'
import type { Project } from '../shared/types.js'
import {
  finishEpisode,
  takeDueEpisode
} from '../storage/projectWatch.js'
import {
  getProjectById,
  listPendingWatchEvents,
  markEvents,
  recordBatch,
  transitionToDispatching,
  type WatchEventRow
} from '../storage/repositories.js'
import {
  parseWatchPayload,
  watchNotificationText,
  type ValidWatchPayload
} from '../shared/watchNotificationText.js'

export const WATCH_BATCH_THRESHOLD = 3

export type WatchNotifyResult = 'sent' | 'failed' | 'suppressed' | 'batched'

export interface WatchSinglePayload {
  eventId: number
  project: Project
  kind: 'watch_status' | 'watch_contact'
  text: string
}

export interface WatchSummaryPayload {
  eventIds: number[]
  projects: Project[]
}

export interface WatchDispatchDeps {
  sendSingle: (p: WatchSinglePayload) => Promise<boolean>
  sendSummary: (p: WatchSummaryPayload) => Promise<boolean>
  eligible: (
    event: { kind: 'watch_status' | 'watch_contact'; attribution: 'sure' | 'maybe' | null },
    project: Project
  ) => boolean
  onBeep?: () => void
}

export interface WatchResultEntry {
  eventId: number
  projectId: number
  source: string
  kind: 'watch_status' | 'watch_contact'
  change: 'contact_sure' | 'contact_maybe' | 'status_in_progress' | 'status_closed'
  result: WatchNotifyResult
}

export interface WatchDispatchOutcome {
  results: WatchResultEntry[]
}

function determineChange(
  kind: 'watch_status' | 'watch_contact',
  valid: ValidWatchPayload | null
): 'contact_sure' | 'contact_maybe' | 'status_in_progress' | 'status_closed' {
  if (!valid) {
    return kind === 'watch_status' ? 'status_closed' : 'contact_maybe'
  }
  if (valid.kind === 'watch_contact') {
    return valid.attribution === 'sure' ? 'contact_sure' : 'contact_maybe'
  }
  return valid.to === 'in_progress' ? 'status_in_progress' : 'status_closed'
}

export async function dispatchWatchPending(
  db: Db,
  opts: { sessionId: string; nowIso: string; lang: 'ar' | 'en' },
  deps: WatchDispatchDeps
): Promise<WatchDispatchOutcome> {
  const pending = listPendingWatchEvents(db)
  if (pending.length === 0) return { results: [] }

  const results: WatchResultEntry[] = []
  interface KeptEvent {
    event: WatchEventRow
    project: Project
    valid: ValidWatchPayload
    resultItem: WatchResultEntry
  }
  const kept: KeptEvent[] = []

  for (const event of pending) {
    const valid = parseWatchPayload(event.kind, event.payload)
    const change = determineChange(event.kind, valid)
    const project = getProjectById(db, event.project_id)

    if (!project || valid === null) {
      markEvents(db, [event.id], 'failed', null, opts.nowIso)
      results.push({
        eventId: event.id,
        projectId: event.project_id,
        source: project?.source ?? '',
        kind: event.kind,
        change,
        result: 'failed'
      })
      continue
    }

    const attribution = valid.kind === 'watch_contact' ? valid.attribution : null

    if (!deps.eligible({ kind: event.kind, attribution }, project)) {
      markEvents(db, [event.id], 'suppressed', null, opts.nowIso)
      results.push({
        eventId: event.id,
        projectId: event.project_id,
        source: project.source,
        kind: event.kind,
        change,
        result: 'suppressed'
      })
      continue
    }

    const resultItem: WatchResultEntry = {
      eventId: event.id,
      projectId: event.project_id,
      source: project.source,
      kind: event.kind,
      change,
      result: 'failed'
    }
    results.push(resultItem)
    kept.push({
      event,
      project,
      valid,
      resultItem
    })
  }

  if (kept.length === 0) return { results }

  const distinctProjects: Project[] = []
  const seenProjectIds = new Set<number>()
  for (let i = kept.length - 1; i >= 0; i--) {
    const item = kept[i]
    if (!item) continue
    const p = item.project
    if (!seenProjectIds.has(p.id)) {
      seenProjectIds.add(p.id)
      distinctProjects.push(p)
    }
  }

  if (distinctProjects.length > WATCH_BATCH_THRESHOLD) {
    const keptIds = kept.map((k) => k.event.id)
    const batchKey = `watch-batch:${opts.nowIso}`
    transitionToDispatching(db, keptIds, opts.sessionId, opts.nowIso)
    let ok: boolean
    try {
      ok = (await deps.sendSummary({
        eventIds: keptIds,
        projects: distinctProjects
      })) === true
    } catch {
      ok = false
    }
    markEvents(db, keptIds, ok ? 'submitted' : 'failed', batchKey, opts.nowIso)
    recordBatch(db, batchKey, keptIds.length, opts.nowIso)
    for (const k of kept) {
      k.resultItem.result = ok ? 'batched' : 'failed'
    }
    if (ok) {
      deps.onBeep?.()
    }
    return { results }
  }

  for (const k of kept) {
    const text = watchNotificationText(k.valid, opts.lang)
    transitionToDispatching(db, [k.event.id], opts.sessionId, opts.nowIso)
    let ok: boolean
    try {
      ok = (await deps.sendSingle({
        eventId: k.event.id,
        project: k.project,
        kind: k.event.kind,
        text
      })) === true
    } catch {
      ok = false
    }
    markEvents(db, [k.event.id], ok ? 'submitted' : 'failed', null, opts.nowIso)
    k.resultItem.result = ok ? 'sent' : 'failed'
    if (ok) {
      deps.onBeep?.()
    }
  }

  return { results }
}

export interface WatchAwayPayload {
  episodeId: number
  eventIds: number[]
  projects: Project[]
}

export interface WatchEpisodeDispatchDeps {
  sendAway: (p: WatchAwayPayload) => Promise<boolean>
  eligible: (
    event: { kind: 'watch_status' | 'watch_contact'; attribution: 'sure' | 'maybe' | null },
    project: Project
  ) => boolean
  onBeep?: () => void
}

export async function dispatchWatchEpisode(
  db: Db,
  opts: { sessionId: string; nowIso: string; silent: boolean },
  deps: WatchEpisodeDispatchDeps
): Promise<WatchDispatchOutcome> {
  const taken = takeDueEpisode(db, { now: opts.nowIso })
  if (!taken) return { results: [] }

  const results: WatchResultEntry[] = []

  try {
    interface KeptEpisodeEvent {
      event: { id: number; project_id: number; kind: 'watch_status' | 'watch_contact'; payload: string | null }
      project: Project
      valid: ValidWatchPayload
      resultItem: WatchResultEntry
    }
    const kept: KeptEpisodeEvent[] = []

    for (const event of taken.events) {
      const valid = parseWatchPayload(event.kind, event.payload)
      const change = determineChange(event.kind, valid)
      const project = getProjectById(db, event.project_id)

      if (!project || valid === null) {
        markEvents(db, [event.id], 'failed', null, opts.nowIso)
        results.push({
          eventId: event.id,
          projectId: event.project_id,
          source: project?.source ?? '',
          kind: event.kind,
          change,
          result: 'failed'
        })
        continue
      }

      const attribution = valid.kind === 'watch_contact' ? valid.attribution : null

      if (opts.silent || !deps.eligible({ kind: event.kind, attribution }, project)) {
        markEvents(db, [event.id], 'suppressed', null, opts.nowIso)
        results.push({
          eventId: event.id,
          projectId: event.project_id,
          source: project.source,
          kind: event.kind,
          change,
          result: 'suppressed'
        })
        continue
      }

      const resultItem: WatchResultEntry = {
        eventId: event.id,
        projectId: event.project_id,
        source: project.source,
        kind: event.kind,
        change,
        result: 'failed'
      }
      results.push(resultItem)
      kept.push({
        event,
        project,
        valid,
        resultItem
      })
    }

    if (kept.length > 0) {
      const distinctProjects: Project[] = []
      const seenProjectIds = new Set<number>()
      for (let i = kept.length - 1; i >= 0; i--) {
        const item = kept[i]
        if (!item) continue
        const p = item.project
        if (!seenProjectIds.has(p.id)) {
          seenProjectIds.add(p.id)
          distinctProjects.push(p)
        }
      }

      const keptIds = kept.map((k) => k.event.id)
      const batchKey = `watch-episode:${taken.episodeId}`
      transitionToDispatching(db, keptIds, opts.sessionId, opts.nowIso)

      let ok: boolean
      try {
        ok =
          (await deps.sendAway({
            episodeId: taken.episodeId,
            eventIds: keptIds,
            projects: distinctProjects
          })) === true
      } catch {
        ok = false
      }

      markEvents(db, keptIds, ok ? 'submitted' : 'failed', batchKey, opts.nowIso)
      recordBatch(db, batchKey, keptIds.length, opts.nowIso)
      for (const k of kept) {
        k.resultItem.result = ok ? 'batched' : 'failed'
      }
      if (ok) {
        try {
          deps.onBeep?.()
        } catch {
          // swallow onBeep error
        }
      }
    }
  } catch {
    // swallow so dispatchWatchEpisode never rejects
  } finally {
    try {
      finishEpisode(db, { episodeId: taken.episodeId, now: opts.nowIso })
    } catch {
      // swallow
    }
  }

  return { results }
}
