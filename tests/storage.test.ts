import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { SCHEMA_VERSION, applyMigrations } from '../src/storage/migrations.js'
import { downgradeToSchema10, removeSearchSchema } from './helpers/oldSchema.js'
import {
  countProjects,
  countPurgeable,
  createPendingEvents,
  getEventsByIds,
  getProjectById,
  hydrateProjects,
  getSettingRaw,
  getSourceState,
  hasBatch,
  listDiagnostics,
  listEventsByStatus,
  markAllRead,
  markEvents,
  markStaleDispatchingUncertain,
  purgeHistory,
  recordBatch,
  recordDiagnostic,
  runInTransaction,
  saveSourceState,
  setReadState,
  setSettingRaw,
  transitionToDispatching,
  upsertProjectsBatch,
  type UpsertInput
} from '../src/storage/repositories.js'
import { getWatch, setWatch } from '../src/storage/projectWatch.js'

let dir = ''
let db: Db

const item = (id: string, title = `title ${id}`): UpsertInput => ({
  source: 'mostaql',
  externalId: id,
  url: `https://mostaql.com/go/${id}`,
  title,
  descriptionExcerpt: `excerpt ${id}`,
  publishedAt: '2026-09-24T13:00:00.000Z',
  publishedRaw: 'Thu, 24 Sep 2026 13:00:00 +0000'
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-test-'))
  db = openDatabase(join(dir, 'test.db'))
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('migrations', () => {
  it('applies the current schema and reopens cleanly', () => {
    const row = db.prepare('PRAGMA user_version;').get() as { user_version: number }
    expect(row.user_version).toBe(SCHEMA_VERSION)
    const path = join(dir, 'test.db')
    closeDatabase(db)
    db = openDatabase(path)
    const again = db.prepare('PRAGMA user_version;').get() as { user_version: number }
    expect(again.user_version).toBe(SCHEMA_VERSION)
  })

  it('upgrades a version 1 database without losing projects', () => {
    upsertProjectsBatch(db, [item('upgrade')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const path = join(dir, 'test.db')
    closeDatabase(db)
    db = openDatabase(path)
    downgradeToSchema10(db)
    removeSearchSchema(db)
    db.exec('ALTER TABLE projects DROP COLUMN platform_status; ALTER TABLE projects DROP COLUMN duration_days; ALTER TABLE projects DROP COLUMN duration_raw; DROP TABLE extension_jobs; DROP TABLE quick_apply_tickets; DROP TABLE proposal_drafts; DROP TABLE project_user_state; DROP TABLE project_details; DROP TABLE saved_filters; DROP TABLE tombstones; DROP TABLE pending_classifications; PRAGMA user_version = 1;')
    closeDatabase(db)
    db = openDatabase(path)
    expect(getProjectById(db, 1)?.externalId).toBe('upgrade')
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_classifications';").get()
    expect(table).toBeDefined()
  })

  it('initializes a fresh database at schema version 11 with watch tables and checks ok', () => {
    const version = (db.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version
    expect(version).toBe(11)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name)
    expect(tables).toContain('project_watch')
    expect(tables).toContain('watch_source_state')
    expect(tables).toContain('watch_episode')
    expect(tables).toContain('watch_episode_member')
    const cols = (db.prepare('PRAGMA table_info(notification_events)').all() as { name: string }[]).map(r => r.name)
    expect(cols).toContain('dedupe_key')
    expect(cols).toContain('payload')
    expect(cols).toContain('episode_id')
    const actCols = (db.prepare('PRAGMA table_info(notification_activations)').all() as { name: string }[]).map(r => r.name)
    expect(actCols).toContain('origin')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect((db.prepare('PRAGMA integrity_check').get() as Record<string, string>)['integrity_check']).toBe('ok')
  })

  it('upgrades a real version-10 database preserving all notification events rows and metadata', () => {
    downgradeToSchema10(db)
    db.exec('PRAGMA user_version = 10;')
    upsertProjectsBatch(db, [item('101'), item('102'), item('103'), item('104'), item('105'), item('106')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const statuses = ['pending', 'dispatching', 'submitted', 'failed', 'uncertain', 'suppressed']
    for (const [i, status] of statuses.entries()) {
      db.prepare(`
        INSERT INTO notification_events (id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at)
        VALUES (?, ?, 'new_project', ?, ?, ?, ?, '2026-09-24T14:00:00.000Z', '2026-09-24T14:00:00.000Z')
      `).run(i + 1, i + 1, status, `session-${i}`, `2026-09-24T14:01:0${i}.000Z`, `batch-${i}`)
    }
    interface EventFullRow {
      id: number
      project_id: number
      kind: string
      status: string
      session_id: string | null
      attempted_at: string | null
      batch_key: string | null
      created_at: string
      updated_at: string
      dedupe_key: string
      payload: string | null
      episode_id: number | null
    }
    const beforeRows = db.prepare('SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events ORDER BY id ASC').all() as unknown as Omit<EventFullRow, 'dedupe_key' | 'payload' | 'episode_id'>[]
    applyMigrations(db)
    const version = (db.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version
    expect(version).toBe(11)
    const afterRows = db.prepare('SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at, dedupe_key, payload, episode_id FROM notification_events ORDER BY id ASC').all() as unknown as EventFullRow[]
    expect(afterRows).toHaveLength(beforeRows.length)
    for (let i = 0; i < afterRows.length; i++) {
      const b = beforeRows[i]!
      const a = afterRows[i]!
      expect(a.id).toBe(b.id)
      expect(a.project_id).toBe(b.project_id)
      expect(a.kind).toBe(b.kind)
      expect(a.status).toBe(b.status)
      expect(a.session_id).toBe(b.session_id)
      expect(a.attempted_at).toBe(b.attempted_at)
      expect(a.batch_key).toBe(b.batch_key)
      expect(a.created_at).toBe(b.created_at)
      expect(a.updated_at).toBe(b.updated_at)
      expect(a.dedupe_key).toBe('')
      expect(a.payload).toBeNull()
      expect(a.episode_id).toBeNull()
    }
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notify_status'").get()
    expect(idx).toBeDefined()
  })

  it('preserves notification_events autoincrement sequence across upgrade', () => {
    downgradeToSchema10(db)
    db.exec('PRAGMA user_version = 10;')
    upsertProjectsBatch(db, [item('201'), item('202'), item('203'), item('204'), item('205')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    for (let i = 1; i <= 5; i++) {
      db.prepare("INSERT INTO notification_events (id, project_id, kind, status, created_at, updated_at) VALUES (?, ?, 'new_project', 'pending', 't', 't')").run(i, i)
    }
    db.exec('DELETE FROM notification_events WHERE id IN (4, 5);')
    applyMigrations(db)
    // Inserting a new event should get id 6, not reusing 4 or 5
    db.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'pending', 'k1', 't', 't')").run()
    const lastRow = db.prepare('SELECT id FROM notification_events ORDER BY id DESC LIMIT 1').get() as { id: number }
    expect(lastRow.id).toBe(6)

    // Empty-table case: insert then delete all rows before upgrading
    downgradeToSchema10(db)
    db.exec("PRAGMA user_version = 10; DELETE FROM notification_events; DELETE FROM sqlite_sequence WHERE name = 'notification_events';")
    for (let i = 1; i <= 3; i++) {
      db.prepare("INSERT INTO notification_events (id, project_id, kind, status, created_at, updated_at) VALUES (?, ?, 'new_project', 'pending', 't', 't')").run(i, i)
    }
    db.exec('DELETE FROM notification_events;')
    applyMigrations(db)
    db.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'pending', 'k2', 't', 't')").run()
    const nextRow = db.prepare('SELECT id FROM notification_events ORDER BY id DESC LIMIT 1').get() as { id: number }
    expect(nextRow.id).toBe(4)
  })

  it('enforces uniqueness semantics after upgrade with dedupe_key', () => {
    upsertProjectsBatch(db, [item('301')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const r1 = createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')
    expect(r1).toHaveLength(1)
    const r2 = createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')
    expect(r2).toHaveLength(0)

    db.prepare("INSERT INTO notification_events (project_id, kind, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'dedupe-1', 't', 't')").run()
    db.prepare("INSERT INTO notification_events (project_id, kind, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'dedupe-2', 't', 't')").run()
    expect(() =>
      db.prepare("INSERT INTO notification_events (project_id, kind, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'dedupe-1', 't', 't')").run()
    ).toThrow()
  })

  it('listEventsByStatus filters exclusively for new_project kind', () => {
    upsertProjectsBatch(db, [item('401')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')
    db.prepare("INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at) VALUES (1, 'watch_status', 'pending', 'w1', 't', 't')").run()
    const pending = listEventsByStatus(db, 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]?.kind).toBe('new_project')
  })

  it('enforces foreign key cascading and state check on watch tables', () => {
    upsertProjectsBatch(db, [item('501')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    db.prepare("INSERT INTO project_watch (project_id, state, origin) VALUES (1, 'active', 'manual')").run()
    db.prepare("INSERT INTO watch_episode (id, started_at, deadline_at, summary_state) VALUES (10, 't1', 't2', 'open')").run()
    db.prepare("INSERT INTO watch_episode_member (episode_id, project_id, generation, observed) VALUES (10, 1, 0, 0)").run()

    expect(() =>
      db.prepare("UPDATE project_watch SET state = 'bogus' WHERE project_id = 1").run()
    ).toThrow(/CHECK constraint/i)

    // Cascade delete on project: removes project_watch and watch_episode_member
    db.prepare('DELETE FROM projects WHERE id = 1').run()
    expect(db.prepare('SELECT 1 FROM project_watch WHERE project_id = 1').get()).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM watch_episode_member WHERE project_id = 1').get()).toBeUndefined()

    // Cascade delete on watch_episode: removes members
    upsertProjectsBatch(db, [item('502')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    db.prepare("INSERT INTO watch_episode (id, started_at, deadline_at) VALUES (20, 't1', 't2')").run()
    db.prepare("INSERT INTO watch_episode_member (episode_id, project_id, generation) VALUES (20, 2, 0)").run()
    db.prepare('DELETE FROM watch_episode WHERE id = 20').run()
    expect(db.prepare('SELECT 1 FROM watch_episode_member WHERE episode_id = 20').get()).toBeUndefined()
  })

  it('rolls back a failing migration cleanly', () => {
    downgradeToSchema10(db)
    db.exec('PRAGMA user_version = 10;')
    upsertProjectsBatch(
      db,
      [item('601'), item('602'), item('603'), item('604'), item('605')],
      { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' }
    )
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO notification_events (id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at)
        VALUES (?, ?, 'new_project', 'pending', ?, '2026-09-24T14:01:00.000Z', ?, '2026-09-24T14:00:00.000Z', '2026-09-24T14:00:00.000Z')
      `).run(i, i, `session-${i}`, `batch-${i}`)
    }
    db.exec('DELETE FROM notification_events WHERE id IN (4, 5);')
    const seqBefore = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notification_events'").get() as { seq: number }).seq
    expect(seqBefore).toBe(5)
    const rowsBefore = db.prepare('SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events ORDER BY id ASC').all()
    expect(rowsBefore).toHaveLength(3)

    // Force migration 11 to fail at its LAST statement (CREATE INDEX idx_notify_status ON notification_events(status);).
    // In schema 10, idx_notify_status is on notification_events, which gets dropped during migration 11.
    // Pre-creating idx_notify_status on `projects` survives the DROP TABLE notification_events,
    // so the final CREATE INDEX idx_notify_status throws an already-exists error.
    db.exec('DROP INDEX IF EXISTS idx_notify_status; CREATE INDEX idx_notify_status ON projects(id);')

    expect(() => applyMigrations(db)).toThrow()
    const version = (db.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version
    expect(version).toBe(10)

    const cols = (db.prepare('PRAGMA table_info(notification_events)').all() as { name: string }[]).map(r => r.name)
    expect(cols).toEqual(['id', 'project_id', 'kind', 'status', 'session_id', 'attempted_at', 'batch_key', 'created_at', 'updated_at'])
    expect(cols).not.toContain('dedupe_key')

    const rowsAfter = db.prepare('SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events ORDER BY id ASC').all()
    expect(rowsAfter).toEqual(rowsBefore)

    const seqAfter = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notification_events'").get() as { seq: number }).seq
    expect(seqAfter).toBe(seqBefore)

    const newTables = ['project_watch', 'watch_source_state', 'watch_episode', 'watch_episode_member']
    for (const tbl of newTables) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tbl)).toBeUndefined()
    }
  })
})

describe('upsertProjectsBatch', () => {
  it('inserts new ids regardless of numeric order (no max watermark)', () => {
    const r1 = upsertProjectsBatch(db, [item('999')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    expect(r1.insertedIds).toHaveLength(1)
    // a SMALLER id arriving later is still a new project
    const r2 = upsertProjectsBatch(db, [item('5')], { now: '2026-09-24T14:01:00.000Z', discoveryKind: 'live' })
    expect(r2.insertedIds).toHaveLength(1)
    // same feed repeated / reordered: touches last-seen, with no visible changes
    const r3 = upsertProjectsBatch(db, [item('5'), item('999')], { now: '2026-09-24T14:02:00.000Z', discoveryKind: 'live' })
    expect(r3.insertedIds).toHaveLength(0)
    expect(r3.updatedIds).toHaveLength(0)
  })

  it('updates text without touching firstSeen/discovery/read state', () => {
    upsertProjectsBatch(db, [item('42', 'v1')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const before = getProjectById(db, 1)
    setReadState(db, 1, true, '2026-09-24T14:05:00.000Z')
    const changed = upsertProjectsBatch(db, [item('42', 'v2 edited')], { now: '2026-09-24T14:10:00.000Z', discoveryKind: 'live' })
    expect(changed.updatedIds).toEqual([1])
    const after = getProjectById(db, 1)
    expect(after?.title).toBe('v2 edited')
    expect(after?.firstSeenAt).toBe(before?.firstSeenAt)
    expect(after?.discoveryKind).toBe('live')
    expect(after?.readAt).toBe('2026-09-24T14:05:00.000Z')
  })

  it('rolls back the whole batch on a constraint failure', () => {
    expect(() =>
      runInTransaction(db, () => {
        upsertProjectsBatch(db, [item('1')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
        throw new Error('simulated crash mid-batch')
      })
    ).toThrow()
    expect(countProjects(db, {}).total).toBe(0)
  })

  it('enforces source+externalId uniqueness at the DB level', () => {
    upsertProjectsBatch(db, [item('7')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    expect(() =>
      db.prepare("INSERT INTO projects (source, external_id, url, title, first_seen_at, last_seen_at, discovery_kind, created_at, updated_at) VALUES ('mostaql','7','x','y','t','t','live','t','t');").run()
    ).toThrow()
  })
})

describe('read state', () => {
  it('marks read/unread and counts correctly', () => {
    upsertProjectsBatch(db, [item('1'), item('2')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    setReadState(db, 1, true)
    expect(countProjects(db, {}).unread).toBe(1)
    setReadState(db, 1, false)
    expect(countProjects(db, {}).unread).toBe(2)
    expect(markAllRead(db)).toBe(2)
    expect(countProjects(db, {}).unread).toBe(0)
  })
})

describe('settings + source_state', () => {
  it('round-trips raw settings and source state', () => {
    setSettingRaw(db, 'app', '{"language":"en"}')
    expect(getSettingRaw(db, 'app')).toBe('{"language":"en"}')
    expect(getSettingRaw(db, 'missing')).toBeNull()
    const s = getSourceState(db, 'mostaql')
    expect(s.baselineComplete).toBe(false)
    saveSourceState(db, { ...s, baselineComplete: true, runId: 'r1' })
    expect(getSourceState(db, 'mostaql').baselineComplete).toBe(true)
  })
})

describe('notification events', () => {
  it('pending -> dispatching -> submitted, with crash recovery to uncertain', () => {
    upsertProjectsBatch(db, [item('1')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const ids = createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')
    expect(ids).toHaveLength(1)
    // duplicate creation is a no-op (unique project+kind)
    expect(createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')).toHaveLength(0)
    transitionToDispatching(db, ids, 'session-A', '2026-09-24T14:00:01.000Z')
    expect(listEventsByStatus(db, 'dispatching')).toHaveLength(1)
    // crash: new session recovers old dispatching rows as uncertain, never auto-resent
    expect(markStaleDispatchingUncertain(db, 'session-B', '2026-09-24T14:05:00.000Z')).toBe(1)
    expect(listEventsByStatus(db, 'uncertain')).toHaveLength(1)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(0)
    // current session rows are untouched
    transitionToDispatching(db, [], 'session-B', '2026-09-24T14:05:00.000Z')
    markEvents(db, getEventsByIds(db, ids).map((e) => e.id), 'failed', null, '2026-09-24T14:06:00.000Z')
    expect(listEventsByStatus(db, 'failed')).toHaveLength(1)
  })

  it('dedupes catch-up summary batches', () => {
    expect(hasBatch(db, 'gap:1')).toBe(false)
    recordBatch(db, 'gap:1', 9, '2026-09-24T14:00:00.000Z')
    expect(hasBatch(db, 'gap:1')).toBe(true)
  })
})

describe('diagnostics', () => {
  it('rotates with a cap and never stores bodies', () => {
    for (let i = 0; i < 510; i++) {
      recordDiagnostic(db, { at: '2026-09-24T14:00:00.000Z', endpointKind: 'rss', status: 'ok', durationMs: 300, itemCount: 20, errorCategory: null, detail: 'x'.repeat(1000) })
    }
    const rows = listDiagnostics(db, 1000)
    expect(rows.length).toBeLessThanOrEqual(500)
    expect(rows[0]?.detail?.length).toBeLessThanOrEqual(500)
    // Hundreds of durable writes can exceed the default timeout on Windows CI.
  }, 90_000)
})

describe('purge with project watch', () => {
  it('purge preview and purge apply keep a project with an active or waiting watch (status none), keep a project watched between preview and apply, and still purge a project whose watch is stopped', () => {
    const cutoffIso = '2026-09-24T15:00:00.000Z'
    const purgeKinds = ['live']

    upsertProjectsBatch(db, [item('p-active')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const pActive = getProjectById(db, 1)!
    expect(pActive).toBeDefined()
    setWatch(db, {
      projectId: pActive.id,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-09-24T14:00:00.000Z'
    })

    // Stop pStopped BEFORE inserting pWaiting so promoteOldestTx does not promote pWaiting
    upsertProjectsBatch(db, [item('p-stopped')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const pStopped = getProjectById(db, 2)!
    setWatch(db, {
      projectId: pStopped.id,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-09-24T14:00:00.000Z'
    })
    setWatch(db, {
      projectId: pStopped.id,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-09-24T14:01:00.000Z'
    })

    upsertProjectsBatch(db, [item('p-waiting')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const pWaiting = getProjectById(db, 3)!
    db.prepare(`
      INSERT INTO project_watch (
        project_id, state, origin, version, generation, revision,
        waiting_since, started_at, stopped_at, stop_reason, auto_start_blocked,
        status, offers, offers_capped, contacts, client_open, client_in_progress,
        status_seen_at, detail_seen_at, last_attempt_at, last_changed_at,
        next_due_at, failures, last_error
      ) VALUES (
        ?, 'waiting', 'list', 1, 0, 0,
        '2026-09-24T14:00:00.000Z', NULL, NULL, NULL, 0,
        NULL, NULL, 0, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, 0, NULL
      );
    `).run(pWaiting.id)

    upsertProjectsBatch(db, [item('p-nowatch')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const pNoWatch = getProjectById(db, 4)!

    upsertProjectsBatch(db, [item('p-between')], { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' })
    const pBetween = getProjectById(db, 5)!

    // Assert pWaiting is still 'waiting' immediately before preview
    expect(getWatch(db, pWaiting.id)?.state).toBe('waiting')

    const purgeableCount = countPurgeable(db, cutoffIso, purgeKinds)
    expect(purgeableCount).toBe(3) // pStopped, pNoWatch, pBetween

    // Start watch on pBetween between preview and apply
    setWatch(db, {
      projectId: pBetween.id,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-09-24T14:02:00.000Z'
    })

    // Assert pWaiting is still 'waiting' and pBetween is 'active' immediately before apply
    expect(getWatch(db, pWaiting.id)?.state).toBe('waiting')
    expect(getWatch(db, pBetween.id)?.state).toBe('active')

    const { deleted } = purgeHistory(db, cutoffIso, purgeKinds)
    expect(deleted).toBe(2) // pStopped and pNoWatch deleted; pBetween kept

    expect(getProjectById(db, pActive.id)).not.toBeNull()
    expect(getProjectById(db, pWaiting.id)).not.toBeNull()
    expect(getProjectById(db, pBetween.id)).not.toBeNull()

    expect(getProjectById(db, pStopped.id)).toBeNull()
    expect(getProjectById(db, pNoWatch.id)).toBeNull()
  })
})

describe('project hydration watch', () => {
  it('returns watch null without a row, and state/version/stopReason with one', () => {
    upsertProjectsBatch(
      db,
      [item('p-no-watch'), item('p-active-watch'), item('p-stopped-watch')],
      { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' }
    )
    const pNoWatch = getProjectById(db, 1)!
    const pActive = getProjectById(db, 2)!
    const pStopped = getProjectById(db, 3)!

    setWatch(db, {
      projectId: pActive.id,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-09-24T14:00:00.000Z'
    })

    setWatch(db, {
      projectId: pStopped.id,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-09-24T14:00:00.000Z'
    })
    setWatch(db, {
      projectId: pStopped.id,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-09-24T14:01:00.000Z'
    })

    const hydrated = hydrateProjects(db, [pNoWatch.id, pActive.id, pStopped.id])

    const hNoWatch = hydrated.get(pNoWatch.id)
    expect(hNoWatch).toBeDefined()
    expect(hNoWatch?.watch).toBeNull()

    const hActive = hydrated.get(pActive.id)
    expect(hActive).toBeDefined()
    expect(hActive?.watch).toEqual({
      state: 'active',
      version: 1,
      stopReason: null
    })

    const hStopped = hydrated.get(pStopped.id)
    expect(hStopped).toBeDefined()
    expect(hStopped?.watch).toEqual({
      state: 'stopped',
      version: 2,
      stopReason: 'manual'
    })
  })
})
