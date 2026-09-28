// Parameterized repositories over `node:sqlite`. No SQL string interpolation
// of user content anywhere; every value passes through bound parameters.

import type { Db } from './db.js'
import type {
  DiscoveryKind,
  DiagnosticEntry,
  EnrichmentStatus,
  NotifyEventStatus,
  Project,
  ProjectQuery
} from '../shared/types.js'
import { utcNowIso } from './db.js'
import { matchesDefinition } from '../shared/filters.js'

export interface UpsertInput {
  source: string
  externalId: string
  url: string
  title: string
  descriptionExcerpt: string
  publishedAt: string | null
  publishedRaw: string | null
}

export interface BatchResult {
  insertedIds: number[]
  updatedIds: number[]
}

export function runInTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const out = fn()
    db.exec('COMMIT;')
    return out
  } catch (err) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      /* ignore */
    }
    throw err
  }
}

interface ProjectRow {
  id: number
  source: string
  external_id: string
  url: string
  title: string
  description_excerpt: string
  published_at: string | null
  published_raw: string | null
  first_seen_at: string
  last_seen_at: string
  discovery_kind: DiscoveryKind
  read_at: string | null
  category_slug: string | null
  category_name: string | null
  category_confirmed: number
  skills_json: string | null
  budget_min: number | null
  budget_max: number | null
  currency: string | null
  budget_raw: string | null
  enrichment_status: EnrichmentStatus
}

function parseSkills(json: string | null): string[] | null {
  if (!json) return null
  try {
    const v: unknown = JSON.parse(json)
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    return null
  } catch {
    return null
  }
}

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    url: row.url,
    title: row.title,
    descriptionExcerpt: row.description_excerpt,
    publishedAt: row.published_at,
    publishedRaw: row.published_raw,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    discoveryKind: row.discovery_kind,
    readAt: row.read_at,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    categoryConfirmed: row.category_confirmed === 1,
    skills: parseSkills(row.skills_json),
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    currency: row.currency,
    budgetRaw: row.budget_raw,
    enrichmentStatus: row.enrichment_status
  }
}

/**
 * Insert new projects, refresh known ones (title/excerpt/lastSeen only).
 * New rows keep firstSeenAt == now; known rows never change firstSeenAt,
 * read state, discovery kind or enrichment data here.
 */
export function upsertProjectsBatch(
  db: Db,
  items: UpsertInput[],
  opts: { now: string; discoveryKind: DiscoveryKind }
): BatchResult {
  const find = db.prepare('SELECT id, title, description_excerpt, url, published_at, published_raw FROM projects WHERE source = ? AND external_id = ?;')
  const insert = db.prepare(
    `INSERT INTO projects (source, external_id, url, title, description_excerpt,
      published_at, published_raw, first_seen_at, last_seen_at, discovery_kind,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
  )
  const touch = db.prepare(
    `UPDATE projects SET title = ?, description_excerpt = ?, url = ?,
      published_at = COALESCE(?, published_at), published_raw = COALESCE(?, published_raw),
      last_seen_at = ?, updated_at = ? WHERE id = ?;`
  )
  const insertedIds: number[] = []
  const updatedIds: number[] = []
  for (const it of items) {
    const existing = find.get(it.source, it.externalId) as
      | { id: number; title: string; description_excerpt: string; url: string; published_at: string | null; published_raw: string | null }
      | undefined
    if (!existing) {
      const r = insert.run(
        it.source,
        it.externalId,
        it.url,
        it.title,
        it.descriptionExcerpt,
        it.publishedAt,
        it.publishedRaw,
        opts.now,
        opts.now,
        opts.discoveryKind,
        opts.now,
        opts.now
      )
      insertedIds.push(Number(r.lastInsertRowid))
    } else {
      touch.run(
        it.title,
        it.descriptionExcerpt,
        it.url,
        it.publishedAt,
        it.publishedRaw,
        opts.now,
        opts.now,
        existing.id
      )
      if (existing.title !== it.title || existing.description_excerpt !== it.descriptionExcerpt || existing.url !== it.url || (it.publishedAt !== null && existing.published_at !== it.publishedAt) || (it.publishedRaw !== null && existing.published_raw !== it.publishedRaw)) updatedIds.push(existing.id)
    }
  }
  return { insertedIds, updatedIds }
}

export function listProjects(db: Db, q: ProjectQuery): Project[] {
  // v1 shape, unified v2 engine: every constraint applies before pagination.
  const def = legacyToFilterDef(q)
  return queryProjectsPage(db, def, { limit: q.limit, offset: q.offset }).rows
}

export function countProjects(db: Db, q: Omit<ProjectQuery, 'limit' | 'offset'>): { total: number; unread: number } {
  const def = legacyToFilterDef(q)
  const { total, unread } = queryProjectsPage(db, def, { limit: 0, offset: 0 })
  return { total, unread }
}

export function saveClassificationWaits(db: Db, waits: Map<number, number>): void {
  const stmt = db.prepare('INSERT INTO pending_classifications(project_id, deadline_at) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET deadline_at = excluded.deadline_at;')
  for (const [id, deadline] of waits) stmt.run(id, new Date(deadline).toISOString())
}

export function listClassificationWaits(db: Db): Map<number, number> {
  const rows = db.prepare('SELECT project_id, deadline_at FROM pending_classifications;').all() as unknown as { project_id: number; deadline_at: string }[]
  return new Map(rows.map((r) => [r.project_id, Date.parse(r.deadline_at)]))
}

export function deleteClassificationWait(db: Db, id: number): void {
  db.prepare('DELETE FROM pending_classifications WHERE project_id = ?;').run(id)
}

export function getProjectById(db: Db, id: number): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?;').get(id) as ProjectRow | undefined
  return row ? mapProject(row) : null
}

export function setReadState(db: Db, id: number, read: boolean, now = utcNowIso()): void {
  db.prepare('UPDATE projects SET read_at = ?, updated_at = ? WHERE id = ?;').run(read ? now : null, now, id)
}

export function markAllRead(db: Db, now = utcNowIso()): number {
  const r = db.prepare('UPDATE projects SET read_at = ?, updated_at = ? WHERE read_at IS NULL;').run(now, now)
  return Number(r.changes)
}

export interface EnrichmentUpdate {
  categorySlug: string | null
  categoryName: string | null
  categoryConfirmed: boolean
  skills: string[] | null
  budgetMin: number | null
  budgetMax: number | null
  currency: string | null
  budgetRaw: string | null
  status: EnrichmentStatus
}

export function updateEnrichment(db: Db, id: number, u: EnrichmentUpdate, now = utcNowIso()): void {
  db.prepare(
    `UPDATE projects SET category_slug = ?, category_name = ?, category_confirmed = ?,
      skills_json = ?, budget_min = ?, budget_max = ?, currency = ?, budget_raw = ?,
      enrichment_status = ?, updated_at = ? WHERE id = ?;`
  ).run(
    u.categorySlug,
    u.categoryName,
    u.categoryConfirmed ? 1 : 0,
    u.skills ? JSON.stringify(u.skills) : null,
    u.budgetMin,
    u.budgetMax,
    u.currency,
    u.budgetRaw,
    u.status,
    now,
    id
  )
}

export function getUnenrichedNewIds(db: Db, limit: number): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM projects WHERE enrichment_status IN ('not_requested','pending')
       ORDER BY first_seen_at DESC, id DESC LIMIT ?;`
    )
    .all(limit) as unknown as { id: number }[]
  return rows.map((r) => r.id)
}

/** Claim rows for enrichment so repeated list queries don't re-enqueue them. */
export function markEnrichmentPending(db: Db, ids: number[], now = utcNowIso()): void {
  if (ids.length === 0) return
  db.prepare(
    `UPDATE projects SET enrichment_status = 'pending', updated_at = ?
     WHERE id IN (${ids.map(() => '?').join(',')}) AND enrichment_status = 'not_requested';`
  ).run(now, ...ids)
}

// ---- settings (validated JSON values) -------------------------------------

export function getSettingRaw(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?;').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setSettingRaw(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;').run(key, value)
}

// ---- source_state ----------------------------------------------------------

export interface SourceState {
  source: string
  baselineComplete: boolean
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  consecutiveFailures: number
  backoffUntil: string | null
  transportKind: string
  runId: string | null
}

export function getSourceState(db: Db, source: string): SourceState {
  const row = db.prepare('SELECT * FROM source_state WHERE source = ?;').get(source) as
    | {
        source: string
        baseline_complete: number
        last_success_at: string | null
        last_attempt_at: string | null
        last_error: string | null
        consecutive_failures: number
        backoff_until: string | null
        transport_kind: string
        run_id: string | null
      }
    | undefined
  if (!row) {
    return {
      source,
      baselineComplete: false,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      consecutiveFailures: 0,
      backoffUntil: null,
      transportKind: 'rss',
      runId: null
    }
  }
  return {
    source: row.source,
    baselineComplete: row.baseline_complete === 1,
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    backoffUntil: row.backoff_until,
    transportKind: row.transport_kind,
    runId: row.run_id
  }
}

export function saveSourceState(db: Db, s: SourceState): void {
  db.prepare(
    `INSERT INTO source_state (source, baseline_complete, last_success_at, last_attempt_at,
      last_error, consecutive_failures, backoff_until, transport_kind, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET baseline_complete = excluded.baseline_complete,
       last_success_at = excluded.last_success_at, last_attempt_at = excluded.last_attempt_at,
       last_error = excluded.last_error, consecutive_failures = excluded.consecutive_failures,
       backoff_until = excluded.backoff_until, transport_kind = excluded.transport_kind,
       run_id = excluded.run_id;`
  ).run(
    s.source,
    s.baselineComplete ? 1 : 0,
    s.lastSuccessAt,
    s.lastAttemptAt,
    s.lastError,
    s.consecutiveFailures,
    s.backoffUntil,
    s.transportKind,
    s.runId
  )
}

// ---- notification_events ----------------------------------------------------

export interface NotifyEventRow {
  id: number
  project_id: number
  kind: string
  status: NotifyEventStatus
  session_id: string | null
  batch_key: string | null
}

export function createPendingEvents(db: Db, projectIds: number[], kind: string, now: string): number[] {
  const stmt = db.prepare(
    `INSERT INTO notification_events (project_id, kind, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?) ON CONFLICT(project_id, kind) DO NOTHING;`
  )
  const ids: number[] = []
  for (const pid of projectIds) {
    const r = stmt.run(pid, kind, now, now)
    if (r.changes === 1) ids.push(Number(r.lastInsertRowid))
  }
  return ids
}

export function listEventsByStatus(db: Db, status: NotifyEventStatus): NotifyEventRow[] {
  return db.prepare('SELECT id, project_id, kind, status, session_id, batch_key FROM notification_events WHERE status = ? ORDER BY id ASC;').all(status) as unknown as NotifyEventRow[]
}

export function getEventsByIds(db: Db, ids: number[]): NotifyEventRow[] {
  if (ids.length === 0) return []
  return db.prepare(`SELECT id, project_id, kind, status, session_id, batch_key FROM notification_events WHERE id IN (${ids.map(() => '?').join(',')});`).all(...ids) as unknown as NotifyEventRow[]
}

export function transitionToDispatching(db: Db, ids: number[], sessionId: string, now: string): void {
  if (ids.length === 0) return
  db.prepare(`UPDATE notification_events SET status = 'dispatching', session_id = ?, attempted_at = ?, updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'pending';`).run(sessionId, now, now, ...ids)
}

export function markEvents(db: Db, ids: number[], status: NotifyEventStatus, batchKey: string | null, now: string): void {
  if (ids.length === 0) return
  db.prepare(`UPDATE notification_events SET status = ?, batch_key = COALESCE(?, batch_key), updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')});`).run(status, batchKey, now, ...ids)
}

/** Crash recovery: dispatching rows from older sessions become uncertain, never auto-resent. */
export function markStaleDispatchingUncertain(db: Db, currentSessionId: string, now: string): number {
  const r = db
    .prepare(`UPDATE notification_events SET status = 'uncertain', updated_at = ? WHERE status = 'dispatching' AND (session_id IS NULL OR session_id != ?);`)
    .run(now, currentSessionId)
  return Number(r.changes)
}

export function recordBatch(db: Db, batchKey: string, eventCount: number, now: string): void {
  db.prepare('INSERT INTO notification_batches (batch_key, created_at, event_count) VALUES (?, ?, ?) ON CONFLICT(batch_key) DO NOTHING;').run(batchKey, now, eventCount)
}

export function hasBatch(db: Db, batchKey: string): boolean {
  const row = db.prepare('SELECT batch_key FROM notification_batches WHERE batch_key = ?;').get(batchKey) as { batch_key: string } | undefined
  return !!row
}

// ---- diagnostics (rotated, never full bodies) -------------------------------

export const DIAGNOSTIC_CAP = 500

export function recordDiagnostic(db: Db, e: DiagnosticEntry): void {
  db.prepare(
    'INSERT INTO diagnostics (at, endpoint_kind, status, duration_ms, item_count, error_category, detail) VALUES (?, ?, ?, ?, ?, ?, ?);'
  ).run(e.at, e.endpointKind, e.status, e.durationMs, e.itemCount, e.errorCategory, e.detail ? e.detail.slice(0, 500) : null)
  db.prepare(`DELETE FROM diagnostics WHERE id NOT IN (SELECT id FROM diagnostics ORDER BY id DESC LIMIT ?);`).run(DIAGNOSTIC_CAP)
}

export function listDiagnostics(db: Db, limit: number): DiagnosticEntry[] {
  return db.prepare('SELECT at, endpoint_kind AS endpointKind, status, duration_ms AS durationMs, item_count AS itemCount, error_category AS errorCategory, detail FROM diagnostics ORDER BY id DESC LIMIT ?;').all(limit) as unknown as DiagnosticEntry[]
}

// ---- v2: personal state, details cache, saved filters, tombstones --------

import type {
  DetailProvenance,
  DetailStatus,
  FilterDefinition,
  PageResult,
  PersonalStatus,
  ProjectDetails,
  ProjectUserState,
  ProjectWithUser,
  SavedFilter
} from '../shared/types.js'
import { defaultFilterDefinition, sanitizeFilterDefinition } from '../shared/types.js'

export function getUserState(db: Db, projectId: number): ProjectUserState {
  const row = db.prepare('SELECT project_id, saved_at, hidden_at, personal_status, note, updated_at FROM project_user_state WHERE project_id = ?;').get(projectId) as
    | { project_id: number; saved_at: string | null; hidden_at: string | null; personal_status: PersonalStatus; note: string; updated_at: string }
    | undefined
  if (!row) {
    return { projectId, savedAt: null, hiddenAt: null, status: 'none', note: '', updatedAt: utcNowIso() }
  }
  return { projectId: row.project_id, savedAt: row.saved_at, hiddenAt: row.hidden_at, status: row.personal_status, note: row.note, updatedAt: row.updated_at }
}

export interface UserStatePatch {
  saved?: boolean
  hidden?: boolean
  status?: PersonalStatus
  note?: string
}

/** Caller must have sanitized the patch. Returns false when the project is unknown. */
export function updateUserState(db: Db, projectId: number, patch: UserStatePatch, now = utcNowIso()): boolean {
  const exists = db.prepare('SELECT id FROM projects WHERE id = ?;').get(projectId) as { id: number } | undefined
  if (!exists) return false
  const cur = getUserState(db, projectId)
  const savedAt = patch.saved === undefined ? cur.savedAt : patch.saved ? (cur.savedAt ?? now) : null
  const hiddenAt = patch.hidden === undefined ? cur.hiddenAt : patch.hidden ? (cur.hiddenAt ?? now) : null
  db.prepare(
    `INSERT INTO project_user_state (project_id, saved_at, hidden_at, personal_status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET saved_at = excluded.saved_at, hidden_at = excluded.hidden_at,
       personal_status = excluded.personal_status, note = excluded.note, updated_at = excluded.updated_at;`
  ).run(projectId, savedAt, hiddenAt, patch.status ?? cur.status, patch.note ?? cur.note, now)
  return true
}

export function getProjectDetailsRow(db: Db, projectId: number): ProjectDetails {
  const row = db.prepare('SELECT project_id, description_text, provenance, fetched_at, status, error_code FROM project_details WHERE project_id = ?;').get(projectId) as
    | { project_id: number; description_text: string | null; provenance: DetailProvenance | null; fetched_at: string | null; status: DetailStatus; error_code: string | null }
    | undefined
  if (!row) {
    return { projectId, text: null, provenance: null, fetchedAt: null, status: 'not_requested', errorCode: null }
  }
  return { projectId: row.project_id, text: row.description_text, provenance: row.provenance, fetchedAt: row.fetched_at, status: row.status, errorCode: row.error_code }
}

export interface DetailsUpdate {
  text: string | null
  provenance: DetailProvenance | null
  fetchedAt: string | null
  status: DetailStatus
  errorCode: string | null
}

export function upsertProjectDetails(db: Db, projectId: number, u: DetailsUpdate): void {
  db.prepare(
    `INSERT INTO project_details (project_id, description_text, provenance, fetched_at, status, error_code)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET description_text = excluded.description_text, provenance = excluded.provenance,
       fetched_at = excluded.fetched_at, status = excluded.status, error_code = excluded.error_code;`
  ).run(projectId, u.text, u.provenance, u.fetchedAt, u.status, u.errorCode)
}

// ---- saved filters --------------------------------------------------------

export function listSavedFilters(db: Db): SavedFilter[] {
  const rows = db.prepare('SELECT id, name, definition_json, created_at, updated_at FROM saved_filters ORDER BY updated_at DESC;').all() as unknown as {
    id: string
    name: string
    definition_json: string
    created_at: string
    updated_at: string
  }[]
  const out: SavedFilter[] = []
  for (const r of rows) {
    try {
      const def = JSON.parse(r.definition_json) as unknown
      out.push({ id: r.id, name: r.name, definition: sanitizeFilterDefinition(def), createdAt: r.created_at, updatedAt: r.updated_at })
    } catch {
      /* skip corrupt rows rather than breaking the list */
    }
  }
  return out
}

export function saveSavedFilterRow(db: Db, f: SavedFilter): void {
  db.prepare(
    'INSERT INTO saved_filters (id, name, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json, updated_at = excluded.updated_at;'
  ).run(f.id, f.name, JSON.stringify(f.definition), f.createdAt, f.updatedAt)
}

export function deleteSavedFilterRow(db: Db, id: string): boolean {
  const r = db.prepare('DELETE FROM saved_filters WHERE id = ?;').run(id)
  return Number(r.changes) > 0
}

// ---- tombstones ------------------------------------------------------------

export function addTombstones(db: Db, source: string, externalIds: string[], now = utcNowIso()): void {
  if (externalIds.length === 0) return
  const stmt = db.prepare('INSERT INTO tombstones (source, external_id, deleted_at) VALUES (?, ?, ?) ON CONFLICT(source, external_id) DO UPDATE SET deleted_at = excluded.deleted_at;')
  for (const eid of externalIds) stmt.run(source, eid, now)
}

export function filterOutTombstoned<T extends { source: string; externalId: string }>(db: Db, items: T[]): T[] {
  if (items.length === 0) return items
  const bySource = new Map<string, T[]>()
  for (const it of items) {
    const arr = bySource.get(it.source) ?? []
    arr.push(it)
    bySource.set(it.source, arr)
  }
  const out: T[] = []
  for (const [source, arr] of bySource) {
    const rows = db.prepare(`SELECT external_id FROM tombstones WHERE source = ? AND external_id IN (${arr.map(() => '?').join(',')});`).all(source, ...arr.map((a) => a.externalId)) as unknown as {
      external_id: string
    }[]
    const dead = new Set(rows.map((r) => r.external_id))
    for (const it of arr) if (!dead.has(it.externalId)) out.push(it)
  }
  return out
}

/** Non-destructive count twin of purgeHistory (same WHERE, no writes). */
export function countPurgeable(db: Db, cutoffIso: string, kinds: string[]): number {
  if (kinds.length === 0) return 0
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM projects p
     LEFT JOIN project_user_state u ON u.project_id = p.id
     LEFT JOIN proposal_drafts d ON d.project_id = p.id
     WHERE p.discovery_kind IN (${kinds.map(() => '?').join(',')})
       AND p.first_seen_at < ?
       AND (u.saved_at IS NULL OR u.project_id IS NULL)
       AND (u.note IS NULL OR u.note = '' OR u.project_id IS NULL)
       AND (u.personal_status IS NULL OR u.personal_status NOT IN ('interested','submitted'))
       AND d.project_id IS NULL;`
  ).get(...kinds, cutoffIso) as { n: number }
  return row.n
}/** Destructive twin of countPurgeable: deletes + tombstones, returns deleted count. */
export function purgeHistory(db: Db, cutoffIso: string, kinds: string[]): { deleted: number } {
  if (kinds.length === 0) return { deleted: 0 }
  const rows = db.prepare(
    `SELECT p.source AS source, p.external_id AS external_id, p.id AS id FROM projects p
     LEFT JOIN project_user_state u ON u.project_id = p.id
     LEFT JOIN proposal_drafts d ON d.project_id = p.id
     WHERE p.discovery_kind IN (${kinds.map(() => '?').join(',')})
       AND p.first_seen_at < ?
       AND (u.saved_at IS NULL OR u.project_id IS NULL)
       AND (u.note IS NULL OR u.note = '' OR u.project_id IS NULL)
       AND (u.personal_status IS NULL OR u.personal_status NOT IN ('interested','submitted'))
       AND d.project_id IS NULL;`
  ).all(...kinds, cutoffIso) as unknown as { source: string; external_id: string; id: number }[]
  if (rows.length === 0) return { deleted: 0 }
  const now = utcNowIso()
  const bySource = new Map<string, string[]>()
  for (const r of rows) {
    const arr = bySource.get(r.source) ?? []
    arr.push(r.external_id)
    bySource.set(r.source, arr)
  }
  for (const [source, eids] of bySource) addTombstones(db, source, eids, now)
  let deleted = 0
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500)
    deleted += Number(db.prepare(`DELETE FROM projects WHERE id IN (${chunk.map(() => '?').join(',')});`).run(...chunk.map(r => r.id)).changes)
  }
  return { deleted }
}

// ---- unified query engine ---------------------------------------------------

interface PrefilterRow extends ProjectRow {
  saved_at: string | null
  hidden_at: string | null
  personal_status: PersonalStatus | null
}

function mapWithUser(row: PrefilterRow): ProjectWithUser {
  return {
    ...mapProject(row),
    saved: row.saved_at !== null,
    hidden: row.hidden_at !== null,
    personalStatus: row.personal_status ?? 'none',
    hasNote: false // filled below when needed; list queries skip note bodies
  }
}

/**
 * Single predicate path for list AND count: SQL pre-filters
 * (scope/unread/status/search), then the shared category+keyword evaluator,
 * budget overlap and sort in JS, then pagination. Nothing filters after paging.
 */
export function queryProjectsPage(db: Db, def: FilterDefinition, page: { limit: number; offset: number }): PageResult {
  const where: string[] = []
  const params: (string | number)[] = []
  if (def.scope === 'hidden') {
    where.push('u.hidden_at IS NOT NULL')
  } else {
    where.push('(u.hidden_at IS NULL OR u.project_id IS NULL)')
    if (def.scope === 'saved') where.push('u.saved_at IS NOT NULL')
  }
  if (def.unreadOnly) where.push('p.read_at IS NULL')
  if (def.statuses.length > 0) {
    where.push(`COALESCE(u.personal_status, 'none') IN (${def.statuses.map(() => '?').join(',')})`)
    params.push(...def.statuses)
  }
  const sql =
    'SELECT p.*, u.saved_at AS saved_at, u.hidden_at AS hidden_at, u.personal_status AS personal_status FROM projects p LEFT JOIN project_user_state u ON u.project_id = p.id' +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY p.first_seen_at DESC, p.id DESC;'
  const pre = db.prepare(sql).all(...params) as unknown as PrefilterRow[]
  const kept: ProjectWithUser[] = []
  for (const row of pre) {
    const base = mapWithUser(row)
    if (!matchesDefinition(base, def)) continue
    kept.push(base)
  }
  if (def.sort === 'latestPublished') {
    kept.sort((a, b) => {
      const pa = a.publishedAt ? Date.parse(a.publishedAt) : NaN
      const pb = b.publishedAt ? Date.parse(b.publishedAt) : NaN
      const aNaN = Number.isNaN(pa)
      const bNaN = Number.isNaN(pb)
      if (aNaN && bNaN) return b.id - a.id
      if (aNaN) return 1
      if (bNaN) return -1
      if (pb !== pa) return pb - pa
      return b.id - a.id
    })
  }
  const total = kept.length
  const unread = kept.filter((p) => !p.readAt).length
  const rows = kept.slice(page.offset, page.offset + page.limit)
  // note bodies stay out of list payloads; flag presence cheaply
  if (rows.length > 0) {
    const notes = db.prepare(`SELECT project_id FROM project_user_state WHERE project_id IN (${rows.map(() => '?').join(',')}) AND note != '';`).all(...rows.map((r) => r.id)) as unknown as {
      project_id: number
    }[]
    const withNote = new Set(notes.map((n) => n.project_id))
    for (const r of rows) r.hasNote = withNote.has(r.id)
  }
  return { rows, total, unread }
}

/** Legacy v1 query shape, mapped onto the unified engine (keeps old tests green). */
export function legacyToFilterDef(q: { unreadOnly?: boolean; search?: string; categories?: string[]; displayFilter?: FilterDefinition['categoryFilter'] }): FilterDefinition {
  const d = defaultFilterDefinition()
  d.unreadOnly = q.unreadOnly === true
  d.search = typeof q.search === 'string' ? q.search : ''
  if (q.displayFilter) {
    d.categoryFilter = q.displayFilter
  } else if (q.categories) {
    d.categoryFilter = {
      mode: 'selected',
      categories: q.categories.filter((c) => c !== '__uncertain'),
      keywordsAny: [],
      keywordsAll: [],
      excludeKeywords: []
    }
  }
  return d
}
