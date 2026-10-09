import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { SCHEMA_VERSION } from '../src/storage/migrations.js'
import {
  countProjects,
  createPendingEvents,
  getEventsByIds,
  getProjectById,
  getSettingRaw,
  getSourceState,
  hasBatch,
  listDiagnostics,
  listEventsByStatus,
  markAllRead,
  markEvents,
  markStaleDispatchingUncertain,
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
    db.exec('DROP TABLE extension_jobs; DROP TABLE quick_apply_tickets; DROP TABLE proposal_drafts; DROP TABLE project_user_state; DROP TABLE project_details; DROP TABLE saved_filters; DROP TABLE tombstones; DROP TABLE pending_classifications; PRAGMA user_version = 1;')
    closeDatabase(db)
    db = openDatabase(path)
    expect(getProjectById(db, 1)?.externalId).toBe('upgrade')
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_classifications';").get()
    expect(table).toBeDefined()
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
  })
})
