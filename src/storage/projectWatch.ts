import type { Db } from './db.js'
import { runInTransaction } from './repositories.js'
import {
  contactAttribution,
  WATCH_CAP_PER_SOURCE,
  WATCH_EXPIRE_MS,
  WATCH_ORIGINS,
  WATCH_SLOT_MS,
  WATCH_SOURCES,
  type WatchContactPayload,
  type WatchEventKind,
  type WatchOrigin,
  type WatchPickPreference,
  type WatchPlatformStatus,
  type WatchReplaceResult,
  type WatchRow,
  type WatchSetResult,
  type WatchSnapshot,
  type WatchSnapshotResult,
  type WatchSource,
  type WatchSourceState,
  type WatchState,
  type WatchStatusPayload,
  type WatchStopReason
} from '../shared/projectWatch.js'

interface WatchDbRow {
  project_id: number
  state: string
  origin: string
  version: number
  generation: number
  revision: number
  waiting_since: string | null
  started_at: string | null
  stopped_at: string | null
  stop_reason: string | null
  auto_start_blocked: number
  status: string | null
  offers: number | null
  offers_capped: number
  contacts: number | null
  client_open: number | null
  client_in_progress: number | null
  status_seen_at: string | null
  detail_seen_at: string | null
  last_attempt_at: string | null
  last_changed_at: string | null
  next_due_at: string | null
  failures: number
  last_error: string | null
}

const KNOWN_STATES: readonly WatchState[] = ['active', 'waiting', 'stopped']
const KNOWN_STOP_REASONS: readonly WatchStopReason[] = [
  'manual',
  'replaced',
  'closed',
  'expired',
  'ignored',
  'gone',
  'source_disabled'
]
const KNOWN_PLATFORM_STATUSES: readonly WatchPlatformStatus[] = [
  'open',
  'in_progress',
  'closed',
  'completed',
  'unknown'
]

const CANONICAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function canonicalTime(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('bad-watch-time')
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error('bad-watch-time')
  }
  const iso = d.toISOString()
  if (!CANONICAL_TIME_RE.test(iso)) {
    throw new Error('bad-watch-time')
  }
  return iso
}

function toWatchRow(r: WatchDbRow): WatchRow {
  const state: WatchState = KNOWN_STATES.includes(r.state as WatchState)
    ? (r.state as WatchState)
    : 'stopped'
  const origin: WatchOrigin = WATCH_ORIGINS.includes(r.origin as WatchOrigin)
    ? (r.origin as WatchOrigin)
    : 'list'
  const stopReason: WatchStopReason | null =
    r.stop_reason !== null && KNOWN_STOP_REASONS.includes(r.stop_reason as WatchStopReason)
      ? (r.stop_reason as WatchStopReason)
      : null
  let status: WatchPlatformStatus | null = null
  if (r.status !== null) {
    status = KNOWN_PLATFORM_STATUSES.includes(r.status as WatchPlatformStatus)
      ? (r.status as WatchPlatformStatus)
      : 'unknown'
  }
  return {
    projectId: r.project_id,
    state,
    origin,
    version: r.version,
    generation: r.generation,
    revision: r.revision,
    waitingSince: r.waiting_since,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    stopReason,
    autoStartBlocked: r.auto_start_blocked === 1,
    status,
    offers: r.offers,
    offersCapped: r.offers_capped === 1,
    contacts: r.contacts,
    clientOpen: r.client_open,
    clientInProgress: r.client_in_progress,
    statusSeenAt: r.status_seen_at,
    detailSeenAt: r.detail_seen_at,
    lastAttemptAt: r.last_attempt_at,
    lastChangedAt: r.last_changed_at,
    nextDueAt: r.next_due_at,
    failures: r.failures,
    lastError: r.last_error
  }
}

function checkWatchable(
  db: Db,
  projectId: number
): { ok: true; source: WatchSource } | { ok: false; error: 'unknown-project' | 'unsupported-source' } {
  const row = db
    .prepare('SELECT id, source FROM projects WHERE id = ?;')
    .get(projectId) as { id: number; source: string } | undefined
  if (!row) return { ok: false, error: 'unknown-project' }
  if (!WATCH_SOURCES.includes(row.source as WatchSource)) {
    return { ok: false, error: 'unsupported-source' }
  }
  return { ok: true, source: row.source as WatchSource }
}

export function getWatch(db: Db, projectId: number): WatchRow | null {
  const row = db
    .prepare('SELECT * FROM project_watch WHERE project_id = ?;')
    .get(projectId) as WatchDbRow | undefined
  return row ? toWatchRow(row) : null
}

export function countActiveWatches(db: Db, source: WatchSource): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM project_watch pw
       JOIN projects p ON p.id = pw.project_id
       WHERE pw.state = 'active' AND p.source = ?;`
    )
    .get(source) as { c: number } | undefined
  return row ? Number(row.c) : 0
}

export interface ListWatchesOptions {
  source?: WatchSource
  state?: WatchState
  limit?: number
  offset?: number
}

export interface ListWatchesResult {
  rows: WatchRow[]
  total: number
}

export function listWatches(db: Db, options?: ListWatchesOptions): ListWatchesResult {
  const limit = Math.min(500, Math.max(1, options?.limit ?? 100))
  const offset = Math.max(0, options?.offset ?? 0)

  const conditions: string[] = []
  const filterParams: (string | number)[] = []

  if (options?.source) {
    conditions.push('(SELECT p.source FROM projects p WHERE p.id = pw.project_id) = ?')
    filterParams.push(options.source)
  }
  if (options?.state) {
    conditions.push('pw.state = ?')
    filterParams.push(options.state)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countSql = `SELECT COUNT(*) AS c FROM project_watch pw ${whereClause};`
  const countRow = (filterParams.length > 0
    ? db.prepare(countSql).get(...filterParams)
    : db.prepare(countSql).get()) as { c: number } | undefined
  const total = countRow ? Number(countRow.c) : 0

  const sql = `
    SELECT pw.*
    FROM project_watch pw
    ${whereClause}
    ORDER BY
      CASE pw.state
        WHEN 'active' THEN 1
        WHEN 'waiting' THEN 2
        WHEN 'stopped' THEN 3
        ELSE 4
      END ASC,
      CASE WHEN pw.state = 'active' THEN pw.started_at END DESC,
      CASE WHEN pw.state = 'waiting' THEN pw.waiting_since END ASC,
      CASE WHEN pw.state = 'waiting' THEN pw.project_id END ASC,
      CASE WHEN pw.state = 'stopped' THEN pw.stopped_at END DESC
    LIMIT ? OFFSET ?;
  `
  const queryParams = [...filterParams, limit, offset]
  const rows = db.prepare(sql).all(...queryParams) as unknown as WatchDbRow[]
  return {
    rows: rows.map(toWatchRow),
    total
  }
}

function promoteOldestTx(db: Db, source: WatchSource, now: string): number | null {
  const canonicalNow = canonicalTime(now)
  const activeCount = countActiveWatches(db, source)
  if (activeCount >= WATCH_CAP_PER_SOURCE) {
    return null
  }
  const candidate = db
    .prepare(
      `SELECT pw.project_id
       FROM project_watch pw
       JOIN projects p ON p.id = pw.project_id
       LEFT JOIN project_user_state pus ON pus.project_id = pw.project_id
       WHERE pw.state = 'waiting'
         AND p.source = ?
         AND (pus.hidden_at IS NULL)
         AND (pus.personal_status IS NULL OR pus.personal_status != 'ignored')
       ORDER BY pw.waiting_since ASC, pw.project_id ASC
       LIMIT 1;`
    )
    .get(source) as { project_id: number } | undefined

  if (!candidate) return null

  db.prepare(`
    UPDATE project_watch SET
      state = 'active',
      generation = generation + 1,
      revision = 0,
      started_at = ?,
      waiting_since = NULL,
      stopped_at = NULL,
      stop_reason = NULL,
      status = NULL,
      offers = NULL,
      offers_capped = 0,
      contacts = NULL,
      client_open = NULL,
      client_in_progress = NULL,
      status_seen_at = NULL,
      detail_seen_at = NULL,
      last_attempt_at = NULL,
      last_changed_at = NULL,
      next_due_at = NULL,
      failures = 0,
      last_error = NULL,
      version = version + 1
    WHERE project_id = ?;
  `).run(canonicalNow, candidate.project_id)

  return candidate.project_id
}

export function setWatchTx(
  db: Db,
  params: {
    projectId: number
    want: 'on' | 'off'
    expectVersion: number | null
    origin: WatchOrigin
    now: string
  }
): WatchSetResult {
  const canonicalNow = canonicalTime(params.now)
  if (!WATCH_ORIGINS.includes(params.origin)) {
    return { ok: false, error: 'bad-origin' }
  }

  const watchable = checkWatchable(db, params.projectId)
  if (!watchable.ok) {
    return { ok: false, error: watchable.error }
  }
  const source = watchable.source

  const cur = getWatch(db, params.projectId)
  if (cur === null) {
    if (params.expectVersion !== null) {
      return { ok: false, error: 'stale' }
    }
  } else {
    if (params.expectVersion === null || cur.version !== params.expectVersion) {
      return { ok: false, error: 'stale' }
    }
  }

  if (params.want === 'on') {
    if (cur === null) {
      const activeCount = countActiveWatches(db, source)
      const isActive = activeCount < WATCH_CAP_PER_SOURCE
      db.prepare(`
        INSERT INTO project_watch (
          project_id, state, origin, version, generation, revision,
          waiting_since, started_at, stopped_at, stop_reason, auto_start_blocked,
          status, offers, offers_capped, contacts, client_open, client_in_progress,
          status_seen_at, detail_seen_at, last_attempt_at, last_changed_at,
          next_due_at, failures, last_error
        ) VALUES (
          ?, ?, ?, 1, ?, 0,
          ?, ?, NULL, NULL, 0,
          NULL, NULL, 0, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL,
          NULL, 0, NULL
        );
      `).run(
        params.projectId,
        isActive ? 'active' : 'waiting',
        params.origin,
        isActive ? 1 : 0,
        isActive ? null : canonicalNow,
        isActive ? canonicalNow : null
      )
      return { ok: true, row: getWatch(db, params.projectId)!, changed: true, promoted: null }
    }

    if (cur.state === 'stopped') {
      const activeCount = countActiveWatches(db, source)
      const isActive = activeCount < WATCH_CAP_PER_SOURCE
      if (isActive) {
        db.prepare(`
          UPDATE project_watch SET
            state = 'active',
            origin = ?,
            version = version + 1,
            generation = generation + 1,
            revision = 0,
            waiting_since = NULL,
            started_at = ?,
            stopped_at = NULL,
            stop_reason = NULL,
            auto_start_blocked = 0,
            status = NULL,
            offers = NULL,
            offers_capped = 0,
            contacts = NULL,
            client_open = NULL,
            client_in_progress = NULL,
            status_seen_at = NULL,
            detail_seen_at = NULL,
            last_attempt_at = NULL,
            last_changed_at = NULL,
            next_due_at = NULL,
            failures = 0,
            last_error = NULL
          WHERE project_id = ?;
        `).run(params.origin, canonicalNow, params.projectId)
      } else {
        db.prepare(`
          UPDATE project_watch SET
            state = 'waiting',
            origin = ?,
            version = version + 1,
            waiting_since = ?,
            started_at = NULL,
            stopped_at = NULL,
            stop_reason = NULL,
            auto_start_blocked = 0
          WHERE project_id = ?;
        `).run(params.origin, canonicalNow, params.projectId)
      }
      return { ok: true, row: getWatch(db, params.projectId)!, changed: true, promoted: null }
    }

    // active or waiting: no change
    return { ok: true, row: cur, changed: false, promoted: null }
  }

  // want === 'off'
  if (cur === null) {
    return { ok: true, row: null, changed: false, promoted: null }
  }

  if (cur.state === 'stopped') {
    if (cur.autoStartBlocked) {
      return { ok: true, row: cur, changed: false, promoted: null }
    }
    db.prepare(`
      UPDATE project_watch SET
        auto_start_blocked = 1,
        version = version + 1
      WHERE project_id = ?;
    `).run(params.projectId)
    return { ok: true, row: getWatch(db, params.projectId)!, changed: true, promoted: null }
  }

  const wasActive = cur.state === 'active'
  db.prepare(`
    UPDATE project_watch SET
      state = 'stopped',
      stopped_at = ?,
      stop_reason = 'manual',
      auto_start_blocked = 1,
      waiting_since = NULL,
      next_due_at = NULL,
      version = version + 1
    WHERE project_id = ?;
  `).run(canonicalNow, params.projectId)

  let promoted: number | null = null
  if (wasActive) {
    promoted = promoteOldestTx(db, source, canonicalNow)
  }

  return { ok: true, row: getWatch(db, params.projectId)!, changed: true, promoted }
}

export function setWatch(
  db: Db,
  params: {
    projectId: number
    want: 'on' | 'off'
    expectVersion: number | null
    origin: WatchOrigin
    now: string
  }
): WatchSetResult {
  canonicalTime(params.now)
  return runInTransaction(db, () => setWatchTx(db, params))
}

export function autoStartOnSubmittedTx(db: Db, projectId: number, now: string): WatchSetResult {
  const canonicalNow = canonicalTime(now)
  const watchable = checkWatchable(db, projectId)
  if (!watchable.ok) {
    return { ok: false, error: watchable.error }
  }
  const source = watchable.source

  const cur = getWatch(db, projectId)
  if (cur !== null) {
    if (cur.autoStartBlocked || cur.state === 'active' || cur.state === 'waiting') {
      return { ok: true, row: cur, changed: false, promoted: null }
    }
    const activeCount = countActiveWatches(db, source)
    const isActive = activeCount < WATCH_CAP_PER_SOURCE
    if (isActive) {
      db.prepare(`
        UPDATE project_watch SET
          state = 'active',
          origin = 'auto_submitted',
          version = version + 1,
          generation = generation + 1,
          revision = 0,
          waiting_since = NULL,
          started_at = ?,
          stopped_at = NULL,
          stop_reason = NULL,
          auto_start_blocked = 0,
          status = NULL,
          offers = NULL,
          offers_capped = 0,
          contacts = NULL,
          client_open = NULL,
          client_in_progress = NULL,
          status_seen_at = NULL,
          detail_seen_at = NULL,
          last_attempt_at = NULL,
          last_changed_at = NULL,
          next_due_at = NULL,
          failures = 0,
          last_error = NULL
        WHERE project_id = ?;
      `).run(canonicalNow, projectId)
    } else {
      db.prepare(`
        UPDATE project_watch SET
          state = 'waiting',
          origin = 'auto_submitted',
          version = version + 1,
          waiting_since = ?,
          started_at = NULL,
          stopped_at = NULL,
          stop_reason = NULL,
          auto_start_blocked = 0
        WHERE project_id = ?;
      `).run(canonicalNow, projectId)
    }
    return { ok: true, row: getWatch(db, projectId)!, changed: true, promoted: null }
  }

  const activeCount = countActiveWatches(db, source)
  const isActive = activeCount < WATCH_CAP_PER_SOURCE
  db.prepare(`
    INSERT INTO project_watch (
      project_id, state, origin, version, generation, revision,
      waiting_since, started_at, stopped_at, stop_reason, auto_start_blocked,
      status, offers, offers_capped, contacts, client_open, client_in_progress,
      status_seen_at, detail_seen_at, last_attempt_at, last_changed_at,
      next_due_at, failures, last_error
    ) VALUES (
      ?, ?, 'auto_submitted', 1, ?, 0,
      ?, ?, NULL, NULL, 0,
      NULL, NULL, 0, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, 0, NULL
    );
  `).run(
    projectId,
    isActive ? 'active' : 'waiting',
    isActive ? 1 : 0,
    isActive ? null : canonicalNow,
    isActive ? canonicalNow : null
  )
  return { ok: true, row: getWatch(db, projectId)!, changed: true, promoted: null }
}

export function autoStartOnSubmitted(db: Db, projectId: number, now: string): WatchSetResult {
  canonicalTime(now)
  return runInTransaction(db, () => autoStartOnSubmittedTx(db, projectId, now))
}

export function replaceWatchTx(
  db: Db,
  params: {
    projectId: number
    victimId: number
    expectVersion: number | null
    expectVictimVersion: number
    origin: WatchOrigin
    now: string
  }
): WatchReplaceResult {
  const canonicalNow = canonicalTime(params.now)
  if (!WATCH_ORIGINS.includes(params.origin)) {
    return { ok: false, error: 'bad-origin' }
  }
  if (params.projectId === params.victimId) {
    return { ok: false, error: 'same-project' }
  }

  const destWatchable = checkWatchable(db, params.projectId)
  if (!destWatchable.ok) {
    return { ok: false, error: destWatchable.error }
  }
  const victimWatchable = checkWatchable(db, params.victimId)
  if (!victimWatchable.ok) {
    return { ok: false, error: victimWatchable.error }
  }
  if (destWatchable.source !== victimWatchable.source) {
    return { ok: false, error: 'different-source' }
  }

  const victimRow = getWatch(db, params.victimId)
  if (!victimRow || victimRow.state !== 'active') {
    return { ok: false, error: 'victim-not-active' }
  }
  if (victimRow.version !== params.expectVictimVersion) {
    return { ok: false, error: 'stale' }
  }

  const destRow = getWatch(db, params.projectId)
  if (destRow === null) {
    if (params.expectVersion !== null) {
      return { ok: false, error: 'stale' }
    }
  } else {
    if (params.expectVersion === null || destRow.version !== params.expectVersion) {
      return { ok: false, error: 'stale' }
    }
    if (destRow.state === 'active') {
      return { ok: false, error: 'already-watching' }
    }
  }

  db.prepare(`
    UPDATE project_watch SET
      state = 'stopped',
      stopped_at = ?,
      stop_reason = 'replaced',
      next_due_at = NULL,
      version = version + 1
    WHERE project_id = ?;
  `).run(canonicalNow, params.victimId)

  if (destRow === null) {
    db.prepare(`
      INSERT INTO project_watch (
        project_id, state, origin, version, generation, revision,
        waiting_since, started_at, stopped_at, stop_reason, auto_start_blocked,
        status, offers, offers_capped, contacts, client_open, client_in_progress,
        status_seen_at, detail_seen_at, last_attempt_at, last_changed_at,
        next_due_at, failures, last_error
      ) VALUES (
        ?, 'active', ?, 1, 1, 0,
        NULL, ?, NULL, NULL, 0,
        NULL, NULL, 0, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, 0, NULL
      );
    `).run(params.projectId, params.origin, canonicalNow)
  } else {
    db.prepare(`
      UPDATE project_watch SET
        state = 'active',
        origin = ?,
        version = version + 1,
        generation = generation + 1,
        revision = 0,
        waiting_since = NULL,
        started_at = ?,
        stopped_at = NULL,
        stop_reason = NULL,
        auto_start_blocked = 0,
        status = NULL,
        offers = NULL,
        offers_capped = 0,
        contacts = NULL,
        client_open = NULL,
        client_in_progress = NULL,
        status_seen_at = NULL,
        detail_seen_at = NULL,
        last_attempt_at = NULL,
        last_changed_at = NULL,
        next_due_at = NULL,
        failures = 0,
        last_error = NULL
      WHERE project_id = ?;
    `).run(params.origin, canonicalNow, params.projectId)
  }

  return {
    ok: true,
    row: getWatch(db, params.projectId)!,
    victim: getWatch(db, params.victimId)!
  }
}

export function replaceWatch(
  db: Db,
  params: {
    projectId: number
    victimId: number
    expectVersion: number | null
    expectVictimVersion: number
    origin: WatchOrigin
    now: string
  }
): WatchReplaceResult {
  canonicalTime(params.now)
  return runInTransaction(db, () => replaceWatchTx(db, params))
}

export function stopWatchTx(
  db: Db,
  params: {
    projectId: number
    reason: Exclude<WatchStopReason, 'manual' | 'replaced'>
    now: string
    generation?: number
  }
): { changed: boolean; promoted: number | null } {
  const canonicalNow = canonicalTime(params.now)
  const cur = getWatch(db, params.projectId)
  if (!cur || cur.state === 'stopped') {
    return { changed: false, promoted: null }
  }
  if (params.generation !== undefined && cur.generation !== params.generation) {
    return { changed: false, promoted: null }
  }
  const wasActive = cur.state === 'active'
  db.prepare(`
    UPDATE project_watch SET
      state = 'stopped',
      stop_reason = ?,
      stopped_at = ?,
      waiting_since = NULL,
      next_due_at = NULL,
      version = version + 1
    WHERE project_id = ?;
  `).run(params.reason, canonicalNow, params.projectId)

  let promoted: number | null = null
  if (wasActive && params.reason !== 'source_disabled') {
    const proj = db
      .prepare('SELECT source FROM projects WHERE id = ?;')
      .get(params.projectId) as { source: WatchSource } | undefined
    if (proj) {
      promoted = promoteOldestTx(db, proj.source, canonicalNow)
    }
  }
  return { changed: true, promoted }
}

export function stopWatch(
  db: Db,
  params: {
    projectId: number
    reason: Exclude<WatchStopReason, 'manual' | 'replaced'>
    now: string
    generation?: number
  }
): { changed: boolean; promoted: number | null } {
  canonicalTime(params.now)
  return runInTransaction(db, () => stopWatchTx(db, params))
}

export function stopSourceTx(
  db: Db,
  params: { source: WatchSource; now: string }
): number {
  const canonicalNow = canonicalTime(params.now)
  const res = db
    .prepare(`
      UPDATE project_watch
      SET state = 'stopped',
          stop_reason = 'source_disabled',
          stopped_at = ?,
          waiting_since = NULL,
          next_due_at = NULL,
          version = version + 1
      WHERE state IN ('active', 'waiting')
        AND (SELECT p.source FROM projects p WHERE p.id = project_watch.project_id) = ?;
    `)
    .run(canonicalNow, params.source)
  return Number(res.changes)
}

export function stopSource(db: Db, params: { source: WatchSource; now: string }): number {
  canonicalTime(params.now)
  return runInTransaction(db, () => stopSourceTx(db, params))
}

export function saveSnapshotTx(
  db: Db,
  params: {
    projectId: number
    generation: number
    snapshot: WatchSnapshot
    now: string
  }
): WatchSnapshotResult {
  const canonicalNow = canonicalTime(params.now)
  const row = getWatch(db, params.projectId)
  if (!row || row.state !== 'active' || row.generation !== params.generation) {
    return {
      applied: false,
      events: [],
      stopped: null,
      promoted: null,
      row
    }
  }

  const proj = checkWatchable(db, params.projectId)
  if (!proj.ok) {
    return {
      applied: false,
      events: [],
      stopped: null,
      promoted: null,
      row
    }
  }
  const source = proj.source

  const { snapshot, projectId, generation } = params
  const eventsToEmit: {
    kind: WatchEventKind
    payload: WatchStatusPayload | WatchContactPayload
  }[] = []

  let newStatus: WatchPlatformStatus | null = row.status
  let statusSeenAt = row.statusSeenAt
  if (snapshot.status !== null) {
    statusSeenAt = canonicalNow
    if (snapshot.status !== 'unknown') {
      if (row.status === null || row.status === 'unknown') {
        newStatus = snapshot.status
      } else if (snapshot.status !== row.status) {
        newStatus = snapshot.status
        if (newStatus === 'in_progress') {
          eventsToEmit.push({
            kind: 'watch_status',
            payload: { v: 1, from: row.status, to: newStatus }
          })
        } else if (newStatus === 'closed' || newStatus === 'completed') {
          eventsToEmit.push({
            kind: 'watch_status',
            payload: { v: 1, from: row.status, to: newStatus }
          })
        }
      }
    }
  }

  let newContacts = row.contacts
  if (source === 'mostaql' && snapshot.contacts !== null) {
    if (row.contacts === null) {
      newContacts = snapshot.contacts
    } else if (snapshot.contacts > row.contacts) {
      eventsToEmit.push({
        kind: 'watch_contact',
        payload: {
          v: 1,
          from: row.contacts,
          to: snapshot.contacts,
          attribution: contactAttribution(snapshot),
          clientOpen: snapshot.clientOpen
        }
      })
      newContacts = snapshot.contacts
    } else if (snapshot.contacts < row.contacts) {
      newContacts = snapshot.contacts
    }
  }

  const newClientOpen = snapshot.clientOpen !== null ? snapshot.clientOpen : row.clientOpen
  const newClientInProgress =
    snapshot.clientInProgress !== null ? snapshot.clientInProgress : row.clientInProgress

  const newOffers = snapshot.offers !== null ? snapshot.offers : row.offers
  const newOffersCapped =
    snapshot.offers !== null ? (snapshot.offersCapped ? 1 : 0) : (row.offersCapped ? 1 : 0)

  const statusChanged =
    row.status !== null &&
    row.status !== 'unknown' &&
    snapshot.status !== null &&
    snapshot.status !== 'unknown' &&
    snapshot.status !== row.status
  const contactsChanged =
    source === 'mostaql' &&
    row.contacts !== null &&
    snapshot.contacts !== null &&
    snapshot.contacts !== row.contacts

  let newRevision = row.revision
  let newLastChangedAt = row.lastChangedAt
  if (eventsToEmit.length > 0) {
    newRevision = row.revision + 1
    newLastChangedAt = canonicalNow
  } else if (statusChanged || contactsChanged) {
    newLastChangedAt = canonicalNow
  }

  const unobservedMembers = db
    .prepare(`
      SELECT m.episode_id, e.summary_state
      FROM watch_episode_member m
      JOIN watch_episode e ON e.id = m.episode_id
      WHERE m.project_id = ?
        AND m.generation = ?
        AND m.observed = 0
      ORDER BY m.episode_id ASC;
    `)
    .all(projectId, generation) as unknown as { episode_id: number; summary_state: 'open' | 'reserved' | 'done' }[]

  const targetMember =
    unobservedMembers.find((r) => r.summary_state === 'open') ??
    unobservedMembers.find((r) => r.summary_state === 'reserved') ??
    unobservedMembers.find((r) => r.summary_state === 'done')

  let eventStatus: 'pending' | 'suppressed' = 'pending'
  let eventEpisodeId: number | null = null
  if (targetMember) {
    eventEpisodeId = targetMember.episode_id
    eventStatus = targetMember.summary_state === 'open' ? 'pending' : 'suppressed'
  }

  if (unobservedMembers.length > 0) {
    db.prepare(`
      UPDATE watch_episode_member
      SET observed = 1
      WHERE project_id = ?
        AND generation = ?
        AND observed = 0;
    `).run(projectId, generation)
  }

  const emittedEvents: { id: number; kind: WatchEventKind }[] = []
  const insertEventStmt = db.prepare(`
    INSERT INTO notification_events (
      project_id, kind, status, dedupe_key, payload, created_at, updated_at, episode_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `)
  for (const ev of eventsToEmit) {
    const dedupeKey = `${generation}:${newRevision}`
    const payloadJson = JSON.stringify(ev.payload)
    const res = insertEventStmt.run(
      projectId,
      ev.kind,
      eventStatus,
      dedupeKey,
      payloadJson,
      canonicalNow,
      canonicalNow,
      eventEpisodeId
    )
    emittedEvents.push({ id: Number(res.lastInsertRowid), kind: ev.kind })
  }

  const isTerminal =
    (newStatus === 'closed' || newStatus === 'completed') &&
    (row.status === null || row.status === 'unknown' || row.status !== newStatus)

  let newState: WatchState = row.state
  let newStoppedAt = row.stoppedAt
  let newStopReason: WatchStopReason | null = row.stopReason
  let newNextDueAt = row.nextDueAt
  let newVersion = row.version
  let promoted: number | null = null

  if (isTerminal) {
    newState = 'stopped'
    newStoppedAt = canonicalNow
    newStopReason = 'closed'
    newNextDueAt = null
    newVersion = row.version + 1
  }

  db.prepare(`
    UPDATE project_watch SET
      state = ?,
      version = ?,
      revision = ?,
      started_at = ?,
      stopped_at = ?,
      stop_reason = ?,
      status = ?,
      offers = ?,
      offers_capped = ?,
      contacts = ?,
      client_open = ?,
      client_in_progress = ?,
      status_seen_at = ?,
      detail_seen_at = ?,
      last_attempt_at = ?,
      last_changed_at = ?,
      next_due_at = ?,
      failures = 0,
      last_error = NULL
    WHERE project_id = ?;
  `).run(
    newState,
    newVersion,
    newRevision,
    row.startedAt,
    newStoppedAt,
    newStopReason,
    newStatus,
    newOffers,
    newOffersCapped,
    newContacts,
    newClientOpen,
    newClientInProgress,
    statusSeenAt,
    canonicalNow,
    canonicalNow,
    newLastChangedAt,
    newNextDueAt,
    projectId
  )

  if (isTerminal) {
    promoted = promoteOldestTx(db, source, canonicalNow)
  }

  return {
    applied: true,
    events: emittedEvents,
    stopped: isTerminal ? 'closed' : null,
    promoted,
    row: getWatch(db, projectId)
  }
}

export function saveSnapshot(
  db: Db,
  params: {
    projectId: number
    generation: number
    snapshot: WatchSnapshot
    now: string
  }
): WatchSnapshotResult {
  canonicalTime(params.now)
  return runInTransaction(db, () => saveSnapshotTx(db, params))
}

export function recordWatchFailureTx(
  db: Db,
  params: {
    projectId: number
    generation: number
    error: string
    now: string
  }
): boolean {
  const canonicalNow = canonicalTime(params.now)
  const row = getWatch(db, params.projectId)
  if (!row || row.state !== 'active' || row.generation !== params.generation) {
    return false
  }
  const truncatedError = params.error.slice(0, 200)
  db.prepare(`
    UPDATE project_watch SET
      last_attempt_at = ?,
      failures = failures + 1,
      last_error = ?
    WHERE project_id = ?;
  `).run(canonicalNow, truncatedError, params.projectId)
  return true
}

export function recordWatchFailure(
  db: Db,
  params: {
    projectId: number
    generation: number
    error: string
    now: string
  }
): boolean {
  canonicalTime(params.now)
  return runInTransaction(db, () => recordWatchFailureTx(db, params))
}

export function pickDueWatch(
  db: Db,
  params: {
    source: WatchSource
    now: string
    prefer: WatchPickPreference
  }
): { row: WatchRow; submitted: boolean } | null {
  const canonicalNow = canonicalTime(params.now)
  const isPreferSubmitted = params.prefer === 'submitted'
  const row = db
    .prepare(
      `SELECT pw.*,
              CASE WHEN pus.personal_status = 'submitted' THEN 1 ELSE 0 END AS is_submitted
       FROM project_watch pw
       LEFT JOIN project_user_state pus ON pus.project_id = pw.project_id
       WHERE pw.state = 'active'
         AND (SELECT p.source FROM projects p WHERE p.id = pw.project_id) = ?
         AND (pw.next_due_at IS NULL OR pw.next_due_at <= ?)
       ORDER BY
         CASE
           WHEN ? = 1 THEN
             CASE WHEN pus.personal_status = 'submitted' THEN 0 ELSE 1 END
           ELSE
             CASE WHEN pus.personal_status = 'submitted' THEN 1 ELSE 0 END
         END ASC,
         CASE WHEN pw.next_due_at IS NULL THEN 0 ELSE 1 END ASC,
         pw.next_due_at ASC,
         CASE WHEN pw.last_attempt_at IS NULL THEN 0 ELSE 1 END ASC,
         pw.last_attempt_at ASC,
         pw.project_id ASC
       LIMIT 1;`
    )
    .get(params.source, canonicalNow, isPreferSubmitted ? 1 : 0) as
    | (WatchDbRow & { is_submitted: number })
    | undefined

  if (!row) return null

  return {
    row: toWatchRow(row),
    submitted: row.is_submitted === 1
  }
}

export function setNextDueTx(
  db: Db,
  params: {
    projectId: number
    generation: number
    dueAt: string
  }
): boolean {
  const canonicalDueAt = canonicalTime(params.dueAt)
  const res = db
    .prepare(
      `UPDATE project_watch
       SET next_due_at = ?
       WHERE project_id = ? AND state = 'active' AND generation = ?;`
    )
    .run(canonicalDueAt, params.projectId, params.generation)
  return res.changes > 0
}

export function setNextDue(
  db: Db,
  params: {
    projectId: number
    generation: number
    dueAt: string
  }
): boolean {
  canonicalTime(params.dueAt)
  return runInTransaction(db, () => setNextDueTx(db, params))
}

export function expireWatchesTx(
  db: Db,
  params: {
    source: WatchSource
    now: string
    expireMs?: number
  }
): { expired: number[]; promoted: number[] } {
  const canonicalNow = canonicalTime(params.now)
  const expireMs = params.expireMs ?? WATCH_EXPIRE_MS
  const cutoffIso = canonicalTime(new Date(Date.parse(canonicalNow) - expireMs).toISOString())

  const candidates = db
    .prepare(
      `SELECT pw.project_id, pw.started_at
       FROM project_watch pw
       WHERE pw.state = 'active'
         AND pw.started_at IS NOT NULL
         AND pw.started_at <= ?
         AND (SELECT p.source FROM projects p WHERE p.id = pw.project_id) = ?
       ORDER BY pw.started_at ASC, pw.project_id ASC;`
    )
    .all(cutoffIso, params.source) as unknown as { project_id: number; started_at: string }[]

  const expired: number[] = []
  const promoted: number[] = []

  for (const cand of candidates) {
    const res = stopWatchTx(db, {
      projectId: cand.project_id,
      reason: 'expired',
      now: canonicalNow
    })
    if (res.changed) {
      expired.push(cand.project_id)
      if (res.promoted !== null) {
        promoted.push(res.promoted)
      }
    }
  }

  return { expired, promoted }
}

export function expireWatches(
  db: Db,
  params: {
    source: WatchSource
    now: string
    expireMs?: number
  }
): { expired: number[]; promoted: number[] } {
  const canonicalNow = canonicalTime(params.now)
  const expireMs = params.expireMs ?? WATCH_EXPIRE_MS
  canonicalTime(new Date(Date.parse(canonicalNow) - expireMs).toISOString())
  return runInTransaction(db, () => expireWatchesTx(db, params))
}

interface WatchSourceStateDbRow {
  source: string
  slot_ms: number
  success_streak: number
  paused_until: string | null
  blocked_at: string | null
  needs_poll_success: number
}

export function getWatchSourceState(db: Db, source: WatchSource): WatchSourceState {
  const row = db
    .prepare(
      `SELECT source, slot_ms, success_streak, paused_until, blocked_at, needs_poll_success
       FROM watch_source_state
       WHERE source = ?;`
    )
    .get(source) as WatchSourceStateDbRow | undefined

  if (!row) {
    return {
      source,
      slotMs: WATCH_SLOT_MS,
      successStreak: 0,
      pausedUntil: null,
      blockedAt: null,
      needsPollSuccess: false
    }
  }

  return {
    source: row.source as WatchSource,
    slotMs: row.slot_ms,
    successStreak: row.success_streak,
    pausedUntil: row.paused_until,
    blockedAt: row.blocked_at,
    needsPollSuccess: row.needs_poll_success === 1
  }
}

export function saveWatchSourceStateTx(db: Db, state: WatchSourceState): void {
  if (
    !WATCH_SOURCES.includes(state.source as WatchSource) ||
    typeof state.slotMs !== 'number' ||
    !Number.isFinite(state.slotMs) ||
    !Number.isInteger(state.slotMs) ||
    state.slotMs <= 0
  ) {
    throw new Error('bad-watch-source-state')
  }

  const pausedUntil = state.pausedUntil !== null ? canonicalTime(state.pausedUntil) : null
  const blockedAt = state.blockedAt !== null ? canonicalTime(state.blockedAt) : null

  db.prepare(
    `INSERT INTO watch_source_state (
       source, slot_ms, success_streak, paused_until, blocked_at, needs_poll_success
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       slot_ms = excluded.slot_ms,
       success_streak = excluded.success_streak,
       paused_until = excluded.paused_until,
       blocked_at = excluded.blocked_at,
       needs_poll_success = excluded.needs_poll_success;`
  ).run(
    state.source,
    state.slotMs,
    state.successStreak,
    pausedUntil,
    blockedAt,
    state.needsPollSuccess ? 1 : 0
  )
}

export function saveWatchSourceState(db: Db, state: WatchSourceState): void {
  runInTransaction(db, () => saveWatchSourceStateTx(db, state))
}

export const WATCH_EPISODE_MS = 10 * 60 * 1000

export interface WatchEpisodeStartResult {
  episodeId: number | null
  created: boolean
}

export function startEpisodeTx(
  db: Db,
  params: { now: string }
): WatchEpisodeStartResult {
  const canonicalNow = canonicalTime(params.now)

  const reservedRows = db
    .prepare("SELECT id FROM watch_episode WHERE summary_state = 'reserved';")
    .all() as unknown as { id: number }[]

  if (reservedRows.length > 0) {
    db.prepare(`
      UPDATE notification_events
      SET status = 'suppressed', updated_at = ?
      WHERE status = 'pending'
        AND episode_id IN (SELECT id FROM watch_episode WHERE summary_state = 'reserved');
    `).run(canonicalNow)

    db.prepare(`
      UPDATE notification_events
      SET status = 'uncertain', updated_at = ?
      WHERE status = 'dispatching'
        AND episode_id IN (SELECT id FROM watch_episode WHERE summary_state = 'reserved');
    `).run(canonicalNow)

    db.prepare("UPDATE watch_episode SET summary_state = 'done' WHERE summary_state = 'reserved';").run()
  }

  const openRows = db
    .prepare("SELECT id FROM watch_episode WHERE summary_state = 'open' ORDER BY id ASC;")
    .all() as unknown as { id: number }[]

  if (openRows.length > 0) {
    const keepId = openRows[0]!.id
    if (openRows.length > 1) {
      const extraIds = openRows.slice(1).map((r) => r.id)
      for (const extraId of extraIds) {
        db.prepare(`
          UPDATE notification_events
          SET status = 'suppressed', updated_at = ?
          WHERE status = 'pending' AND episode_id = ?;
        `).run(canonicalNow, extraId)
        db.prepare(`
          UPDATE notification_events
          SET status = 'uncertain', updated_at = ?
          WHERE status = 'dispatching' AND episode_id = ?;
        `).run(canonicalNow, extraId)
        db.prepare("UPDATE watch_episode SET summary_state = 'done' WHERE id = ?;").run(extraId)
      }
    }
    return { episodeId: keepId, created: false }
  }

  const activeWatches = db
    .prepare("SELECT project_id, generation FROM project_watch WHERE state = 'active' ORDER BY project_id ASC;")
    .all() as unknown as { project_id: number; generation: number }[]

  if (activeWatches.length === 0) {
    return { episodeId: null, created: false }
  }

  const deadlineIso = canonicalTime(new Date(Date.parse(canonicalNow) + WATCH_EPISODE_MS).toISOString())
  const insertEpisodeStmt = db.prepare(`
    INSERT INTO watch_episode (started_at, deadline_at, summary_state)
    VALUES (?, ?, 'open');
  `)
  const episodeRes = insertEpisodeStmt.run(canonicalNow, deadlineIso)
  const episodeId = Number(episodeRes.lastInsertRowid)

  const insertMemberStmt = db.prepare(`
    INSERT INTO watch_episode_member (episode_id, project_id, generation, observed)
    VALUES (?, ?, ?, 0);
  `)
  for (const w of activeWatches) {
    insertMemberStmt.run(episodeId, w.project_id, w.generation)
  }

  return { episodeId, created: true }
}

export function startEpisode(
  db: Db,
  params: { now: string }
): WatchEpisodeStartResult {
  canonicalTime(params.now)
  return runInTransaction(db, () => startEpisodeTx(db, params))
}

export interface DueEpisodeEvent {
  id: number
  project_id: number
  kind: 'watch_status' | 'watch_contact'
  payload: string | null
}

export interface DueEpisodeResult {
  episodeId: number
  events: DueEpisodeEvent[]
}

export function takeDueEpisodeTx(
  db: Db,
  params: { now: string }
): DueEpisodeResult | null {
  const canonicalNow = canonicalTime(params.now)

  const openEpisode = db
    .prepare("SELECT id, deadline_at FROM watch_episode WHERE summary_state = 'open' ORDER BY id ASC LIMIT 1;")
    .get() as { id: number; deadline_at: string } | undefined

  if (!openEpisode) {
    return null
  }

  let isDue = Date.parse(canonicalNow) >= Date.parse(openEpisode.deadline_at)

  if (!isDue) {
    interface MemberCheckRow {
      project_id: number
      generation: number
      observed: number
      state: string | null
      pw_generation: number | null
    }

    const members = db
      .prepare(`
        SELECT m.project_id, m.generation, m.observed, pw.state, pw.generation AS pw_generation
        FROM watch_episode_member m
        LEFT JOIN project_watch pw ON pw.project_id = m.project_id
        WHERE m.episode_id = ?;
      `)
      .all(openEpisode.id) as unknown as MemberCheckRow[]

    const allFinished = members.every((m) => {
      if (m.observed === 1) return true
      if (m.state === null) return true
      if (m.state !== 'active') return true
      if (m.pw_generation !== m.generation) return true
      return false
    })

    if (allFinished) {
      isDue = true
    }
  }

  if (!isDue) {
    return null
  }

  const events = db
    .prepare(`
      SELECT id, project_id, kind, payload
      FROM notification_events
      WHERE episode_id = ? AND status = 'pending'
      ORDER BY id ASC;
    `)
    .all(openEpisode.id) as unknown as DueEpisodeEvent[]

  db.prepare("UPDATE watch_episode SET summary_state = 'reserved' WHERE id = ?;").run(openEpisode.id)

  return {
    episodeId: openEpisode.id,
    events
  }
}

export function takeDueEpisode(
  db: Db,
  params: { now: string }
): DueEpisodeResult | null {
  canonicalTime(params.now)
  return runInTransaction(db, () => takeDueEpisodeTx(db, params))
}

export function finishEpisodeTx(
  db: Db,
  params: { episodeId: number; now: string }
): boolean {
  const canonicalNow = canonicalTime(params.now)

  db.prepare(`
    UPDATE notification_events
    SET status = 'suppressed', updated_at = ?
    WHERE episode_id = ? AND status = 'pending';
  `).run(canonicalNow, params.episodeId)

  db.prepare(`
    UPDATE notification_events
    SET status = 'uncertain', updated_at = ?
    WHERE episode_id = ? AND status = 'dispatching';
  `).run(canonicalNow, params.episodeId)

  const res = db
    .prepare("UPDATE watch_episode SET summary_state = 'done' WHERE id = ? AND summary_state = 'reserved';")
    .run(params.episodeId)

  return res.changes > 0
}

export function finishEpisode(
  db: Db,
  params: { episodeId: number; now: string }
): boolean {
  canonicalTime(params.now)
  return runInTransaction(db, () => finishEpisodeTx(db, params))
}


