import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { upsertProjectsBatch } from '../src/storage/repositories.js'
import { dispatchPending } from '../src/main/notifier.js'
import {
  dispatchWatchPending,
  type WatchDispatchDeps
} from '../src/main/watchNotifier.js'

let dir = ''
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-watch-notify-'))
  db = openDatabase(join(dir, 'test.db'))
  upsertProjectsBatch(
    db,
    [
      { source: 'mostaql', externalId: '1', url: 'https://mostaql.com/go/1', title: 'Project 1', descriptionExcerpt: 'd1', publishedAt: null, publishedRaw: null },
      { source: 'mostaql', externalId: '2', url: 'https://mostaql.com/go/2', title: 'Project 2', descriptionExcerpt: 'd2', publishedAt: null, publishedRaw: null },
      { source: 'mostaql', externalId: '3', url: 'https://mostaql.com/go/3', title: 'Project 3', descriptionExcerpt: 'd3', publishedAt: null, publishedRaw: null },
      { source: 'mostaql', externalId: '4', url: 'https://mostaql.com/go/4', title: 'Project 4', descriptionExcerpt: 'd4', publishedAt: null, publishedRaw: null }
    ],
    { now: '2026-11-13T12:00:00.000Z', discoveryKind: 'live' }
  )
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

function insertWatchEvent(
  db: Db,
  params: {
    projectId: number
    kind: 'watch_status' | 'watch_contact'
    payload: unknown
    status?: string
    episodeId?: number | null
    dedupeKey?: string
  }
): number {
  const payloadStr =
    params.payload === null
      ? null
      : typeof params.payload === 'string'
      ? params.payload
      : JSON.stringify(params.payload)
  const now = '2026-11-13T12:00:00.000Z'
  const r = db.prepare(`
    INSERT INTO notification_events (project_id, kind, status, dedupe_key, payload, episode_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `).run(
    params.projectId,
    params.kind,
    params.status ?? 'pending',
    params.dedupeKey ?? `key-${Math.random()}`,
    payloadStr,
    params.episodeId ?? null,
    now,
    now
  )
  return Number(r.lastInsertRowid)
}

const defaultDeps = (overrides: Partial<WatchDispatchDeps> = {}): WatchDispatchDeps => ({
  sendSingle: async () => true,
  sendSummary: async () => true,
  eligible: () => true,
  ...overrides
})

describe('dispatchWatchPending', () => {
  it('sends single sure, maybe, and status events with correct text, order, and dispatching state', async () => {
    const e1 = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_contact',
      payload: { v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: null }
    })
    const e2 = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_contact',
      payload: { v: 1, from: 2, to: 4, attribution: 'maybe', clientOpen: 3 }
    })
    const e3 = insertWatchEvent(db, {
      projectId: 2,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })

    const seenOrder: number[] = []
    const seenTexts: string[] = []
    let beepCount = 0

    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async (p) => {
          seenOrder.push(p.eventId)
          seenTexts.push(p.text)
          const row = db
            .prepare('SELECT status FROM notification_events WHERE id = ?;')
            .get(p.eventId) as { status: string }
          expect(row.status).toBe('dispatching')
          return true
        },
        onBeep: () => {
          beepCount++
        }
      })
    )

    expect(seenOrder).toEqual([e1, e2, e3])
    expect(seenTexts).toEqual([
      'The client started talking to freelancers on this project (0 → 2)',
      'The client started talking to freelancers (2 → 4). They have 3 open projects, so it may be this one',
      'The project moved to in progress'
    ])
    expect(beepCount).toBe(3)
    expect(outcome.results.map((r) => r.result)).toEqual(['sent', 'sent', 'sent'])

    const rows = db
      .prepare('SELECT id, status FROM notification_events WHERE id IN (?, ?, ?) ORDER BY id ASC;')
      .all(e1, e2, e3) as { id: number; status: string }[]
    expect(rows.every((r) => r.status === 'submitted')).toBe(true)
  })

  it('marks failed when sendSingle returns false or rejects', async () => {
    const e1 = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })
    const e2 = insertWatchEvent(db, {
      projectId: 2,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'closed' }
    })

    let beepCount = 0
    let callIndex = 0
    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async () => {
          callIndex++
          if (callIndex === 1) return false
          throw new Error('OS toast network failure')
        },
        onBeep: () => {
          beepCount++
        }
      })
    )

    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[0]?.result).toBe('failed')
    expect(outcome.results[1]?.result).toBe('failed')
    expect(beepCount).toBe(0)

    const rows = db
      .prepare('SELECT id, status FROM notification_events WHERE id IN (?, ?) ORDER BY id ASC;')
      .all(e1, e2) as { id: number; status: string }[]
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed'])
  })

  it('handles sync-throwing sendSingle: row marked failed, result failed, and dispatch continues with the next event', async () => {
    const e1 = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })
    const e2 = insertWatchEvent(db, {
      projectId: 2,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })

    let secondCalled = false
    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: (p) => {
          if (p.eventId === e1) {
            throw new Error('sync OS failure')
          }
          secondCalled = true
          return Promise.resolve(true)
        }
      })
    )

    expect(secondCalled).toBe(true)
    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[0]?.result).toBe('failed')
    expect(outcome.results[1]?.result).toBe('sent')

    const r1 = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(e1) as { status: string }
    const r2 = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(e2) as { status: string }
    expect(r1.status).toBe('failed')
    expect(r2.status).toBe('submitted')
  })

  it('handles sync-throwing sendSummary and rejecting sendSummary: all rows failed, results failed, no beep', async () => {
    // 4 events across 4 projects to trigger summary
    const e1 = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e2 = insertWatchEvent(db, { projectId: 2, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e3 = insertWatchEvent(db, { projectId: 3, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e4 = insertWatchEvent(db, { projectId: 4, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })

    let beepCount = 0
    // Case A: sync-throwing sendSummary
    const outSync = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSummary: () => {
          throw new Error('sync summary failure')
        },
        onBeep: () => {
          beepCount++
        }
      })
    )

    expect(beepCount).toBe(0)
    expect(outSync.results.map((r) => r.result)).toEqual(['failed', 'failed', 'failed', 'failed'])
    const rowsSync = db
      .prepare('SELECT status FROM notification_events WHERE id IN (?, ?, ?, ?);')
      .all(e1, e2, e3, e4) as { status: string }[]
    expect(rowsSync.every((r) => r.status === 'failed')).toBe(true)

    // Case B: rejecting sendSummary
    const e5 = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e6 = insertWatchEvent(db, { projectId: 2, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e7 = insertWatchEvent(db, { projectId: 3, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e8 = insertWatchEvent(db, { projectId: 4, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })

    const outReject = await dispatchWatchPending(
      db,
      { sessionId: 'sess-2', nowIso: '2026-11-13T12:00:02.000Z', lang: 'en' },
      defaultDeps({
        sendSummary: async () => {
          throw new Error('rejecting summary failure')
        },
        onBeep: () => {
          beepCount++
        }
      })
    )

    expect(beepCount).toBe(0)
    expect(outReject.results.map((r) => r.result)).toEqual(['failed', 'failed', 'failed', 'failed'])
    const rowsReject = db
      .prepare('SELECT status FROM notification_events WHERE id IN (?, ?, ?, ?);')
      .all(e5, e6, e7, e8) as { status: string }[]
    expect(rowsReject.every((r) => r.status === 'failed')).toBe(true)
  })

  it('marks double-encoded contact payload failed without eligible call or OS call', async () => {
    const inner = JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: null })
    const doubleEncoded = JSON.stringify(inner)
    const eId = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_contact',
      payload: doubleEncoded
    })

    let eligibleCalled = false
    let osCalled = false
    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        eligible: () => {
          eligibleCalled = true
          return true
        },
        sendSingle: async () => {
          osCalled = true
          return true
        }
      })
    )

    expect(eligibleCalled).toBe(false)
    expect(osCalled).toBe(false)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]?.result).toBe('failed')
    expect(outcome.results[0]?.change).toBe('contact_maybe')

    const row = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(eId) as { status: string }
    expect(row.status).toBe('failed')
  })

  it('marks payloads stored as a JSON number, array, or "null" failed', async () => {
    const eNum = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: '123' })
    const eArr = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: '[1, 2]' })
    const eNull = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: 'null' })

    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps()
    )

    expect(outcome.results).toHaveLength(3)
    expect(outcome.results.map((r) => r.result)).toEqual(['failed', 'failed', 'failed'])
    const rows = db
      .prepare('SELECT status FROM notification_events WHERE id IN (?, ?, ?);')
      .all(eNum, eArr, eNull) as { status: string }[]
    expect(rows.every((r) => r.status === 'failed')).toBe(true)
  })

  it('marks contact payload without clientOpen failed', async () => {
    const withoutClientOpen = JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure' })
    const eId = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_contact',
      payload: withoutClientOpen
    })

    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps()
    )

    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]?.result).toBe('failed')
    const row = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(eId) as { status: string }
    expect(row.status).toBe('failed')
  })

  it('reverse isolation: a fresh pending watch event stays pending and dispatchPending never sends it', async () => {
    const watchEventId = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })

    const calledProjects: number[] = []
    await dispatchPending(
      db,
      { sessionId: 'sess-np', nowIso: '2026-11-13T12:00:02.000Z', recovering: false, batchKey: null },
      {
        sendSingle: async (p) => {
          calledProjects.push(p.project.id)
          return true
        },
        sendSummary: async (p) => {
          calledProjects.push(...p.projects.map((proj) => proj.id))
          return true
        }
      }
    )

    expect(calledProjects).toHaveLength(0)
    const row = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(watchEventId) as { status: string }
    expect(row.status).toBe('pending')
  })

  it('forward isolation: watch dispatch never reads, suppresses or sends a pending new_project event', async () => {
    const now = '2026-11-13T12:00:00.000Z'
    const newProjectId = Number(db.prepare(`
      INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at)
      VALUES (2, 'new_project', 'pending', '', ?, ?);
    `).run(now, now).lastInsertRowid)
    const calledProjects: number[] = []
    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-w', nowIso: '2026-11-13T12:00:02.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async (p) => { calledProjects.push(p.project.id); return true },
        sendSummary: async (p) => { calledProjects.push(...p.projects.map((proj) => proj.id)); return true },
        eligible: () => false
      })
    )
    expect(outcome.results).toHaveLength(0)
    expect(calledProjects).toHaveLength(0)
    const row = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(newProjectId) as { status: string }
    expect(row.status).toBe('pending')
  })

  it('summary: asserts all kept rows are dispatching inside stub, notification_batches row exists, interleaved projects ordered newest first by latest event (D, C, A, B), and second call makes no OS call', async () => {
    // Interleaved events: A(1), B(2), A(1), C(3), D(4)
    const e1 = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e2 = insertWatchEvent(db, { projectId: 2, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e3 = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'in_progress', to: 'closed' } })
    const e4 = insertWatchEvent(db, { projectId: 3, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e5 = insertWatchEvent(db, { projectId: 4, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })

    let summaryCalls = 0
    let singleCalls = 0
    let projectsInStub: number[] = []
    const nowIso = '2026-11-13T12:00:05.000Z'
    const expectedBatchKey = `watch-batch:${nowIso}`

    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-sum', nowIso, lang: 'en' },
      defaultDeps({
        sendSummary: async (p) => {
          summaryCalls++
          projectsInStub = p.projects.map((proj) => proj.id)
          // Inside sendSummary, assert every kept row is already 'dispatching'
          const rowsInDb = db
            .prepare(`SELECT status FROM notification_events WHERE id IN (${p.eventIds.map(() => '?').join(',')});`)
            .all(...p.eventIds) as { status: string }[]
          expect(rowsInDb.every((r) => r.status === 'dispatching')).toBe(true)
          return true
        },
        sendSingle: async () => {
          singleCalls++
          return true
        }
      })
    )

    expect(summaryCalls).toBe(1)
    expect(singleCalls).toBe(0)
    // Interleaved A(1), B(2), A(1), C(3), D(4) -> D(4), C(3), A(1), B(2)
    expect(projectsInStub).toEqual([4, 3, 1, 2])
    expect(outcome.results.map((r) => r.result)).toEqual(['batched', 'batched', 'batched', 'batched', 'batched'])

    // Assert a notification_batches row exists with the batch key and the event count (5)
    const batchRow = db
      .prepare('SELECT batch_key, event_count FROM notification_batches WHERE batch_key = ?;')
      .get(expectedBatchKey) as { batch_key: string; event_count: number } | undefined
    expect(batchRow).toBeDefined()
    expect(batchRow?.batch_key).toBe(expectedBatchKey)
    expect(batchRow?.event_count).toBe(5)

    // Assert rows in notification_events are submitted
    const finalRows = db
      .prepare('SELECT status, batch_key FROM notification_events WHERE id IN (?, ?, ?, ?, ?);')
      .all(e1, e2, e3, e4, e5) as { status: string; batch_key: string }[]
    expect(finalRows.every((r) => r.status === 'submitted')).toBe(true)
    expect(finalRows.every((r) => r.batch_key === expectedBatchKey)).toBe(true)

    // A second dispatchWatchPending call afterwards makes no OS call
    let secondSummaryCalls = 0
    let secondSingleCalls = 0
    const outSecond = await dispatchWatchPending(
      db,
      { sessionId: 'sess-sum-2', nowIso: '2026-11-13T12:00:10.000Z', lang: 'en' },
      defaultDeps({
        sendSummary: async () => {
          secondSummaryCalls++
          return true
        },
        sendSingle: async () => {
          secondSingleCalls++
          return true
        }
      })
    )

    expect(secondSummaryCalls).toBe(0)
    expect(secondSingleCalls).toBe(0)
    expect(outSecond.results).toHaveLength(0)
  })

  it('marks suppressed without calling OS when eligible returns false', async () => {
    const e1 = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })

    let osCalled = false
    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        eligible: () => false,
        sendSingle: async () => {
          osCalled = true
          return true
        }
      })
    )

    expect(osCalled).toBe(false)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]?.result).toBe('suppressed')

    const row = db
      .prepare('SELECT status FROM notification_events WHERE id = ?;')
      .get(e1) as { status: string }
    expect(row.status).toBe('suppressed')
  })

  it('marks failed without OS call on missing project, null payload, or malformed payload', async () => {
    upsertProjectsBatch(
      db,
      [{ source: 'mostaql', externalId: '99', url: 'https://mostaql.com/go/99', title: 'Temp', descriptionExcerpt: 'd', publishedAt: null, publishedRaw: null }],
      { now: '2026-11-13T12:00:00.000Z', discoveryKind: 'live' }
    )
    const tempProjRow = db.prepare("SELECT id FROM projects WHERE external_id = '99';").get() as { id: number }
    const eMissingProj = insertWatchEvent(db, {
      projectId: tempProjRow.id,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })
    db.exec('PRAGMA foreign_keys = OFF;')
    db.prepare('DELETE FROM projects WHERE id = ?;').run(tempProjRow.id)
    db.exec('PRAGMA foreign_keys = ON;')

    const eNullPayload = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: null
    })
    const eMalformed = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_contact',
      payload: { v: 1, from: 'bad', to: 1 }
    })

    let osCalled = false
    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async () => {
          osCalled = true
          return true
        }
      })
    )

    expect(osCalled).toBe(false)
    expect(outcome.results).toHaveLength(3)
    expect(outcome.results.map((r) => r.result)).toEqual(['failed', 'failed', 'failed'])

    const rows = db
      .prepare('SELECT id, status FROM notification_events WHERE id IN (?, ?, ?) ORDER BY id ASC;')
      .all(eMissingProj, eNullPayload, eMalformed) as { id: number; status: string }[]
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('leaves events with episode_id set untouched in pending state', async () => {
    const eWithEpisode = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' },
      episodeId: 42
    })
    const eNormal = insertWatchEvent(db, {
      projectId: 2,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })

    const outcome = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps()
    )

    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]?.eventId).toBe(eNormal)

    const rowEpisode = db
      .prepare('SELECT status FROM notification_events WHERE id = ?;')
      .get(eWithEpisode) as { status: string }
    expect(rowEpisode.status).toBe('pending')
  })

  it('sends 3 distinct projects as 3 singles; sends 4 distinct projects as summary newest first', async () => {
    // 3 distinct projects
    insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    insertWatchEvent(db, { projectId: 2, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    insertWatchEvent(db, { projectId: 3, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })

    let singlesCount = 0
    let summaryCount = 0

    const out3 = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async () => { singlesCount++; return true },
        sendSummary: async () => { summaryCount++; return true }
      })
    )
    expect(singlesCount).toBe(3)
    expect(summaryCount).toBe(0)
    expect(out3.results.map((r) => r.result)).toEqual(['sent', 'sent', 'sent'])

    // Now 4 distinct projects
    const e1 = insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e2 = insertWatchEvent(db, { projectId: 2, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e3 = insertWatchEvent(db, { projectId: 3, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    const e4 = insertWatchEvent(db, { projectId: 4, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })

    let summaryProjectIds: number[] = []
    let summaryEventIds: number[] = []
    let beepCount = 0

    const out4 = await dispatchWatchPending(
      db,
      { sessionId: 'sess-2', nowIso: '2026-11-13T12:00:02.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async () => { singlesCount++; return true },
        sendSummary: async (p) => {
          summaryCount++
          summaryProjectIds = p.projects.map((proj) => proj.id)
          summaryEventIds = p.eventIds
          return true
        },
        onBeep: () => {
          beepCount++
        }
      })
    )

    expect(summaryCount).toBe(1)
    expect(summaryEventIds).toEqual([e1, e2, e3, e4])
    // Newest event first: project 4, 3, 2, 1
    expect(summaryProjectIds).toEqual([4, 3, 2, 1])
    expect(beepCount).toBe(1)
    expect(out4.results.map((r) => r.result)).toEqual(['batched', 'batched', 'batched', 'batched'])

    const rows = db
      .prepare('SELECT id, status, batch_key FROM notification_events WHERE id IN (?, ?, ?, ?) ORDER BY id ASC;')
      .all(e1, e2, e3, e4) as { id: number; status: string; batch_key: string | null }[]
    expect(rows.every((r) => r.status === 'submitted')).toBe(true)
    expect(rows.every((r) => r.batch_key === 'watch-batch:2026-11-13T12:00:02.000Z')).toBe(true)
  })

  it('sends singles when 4 events cover only 3 distinct projects', async () => {
    insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    insertWatchEvent(db, { projectId: 1, kind: 'watch_status', payload: { v: 1, from: 'in_progress', to: 'closed' } })
    insertWatchEvent(db, { projectId: 2, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })
    insertWatchEvent(db, { projectId: 3, kind: 'watch_status', payload: { v: 1, from: 'open', to: 'in_progress' } })

    let singlesCount = 0
    let summaryCount = 0

    const out = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async () => { singlesCount++; return true },
        sendSummary: async () => { summaryCount++; return true }
      })
    )

    expect(singlesCount).toBe(4)
    expect(summaryCount).toBe(0)
    expect(out.results).toHaveLength(4)
  })

  it('sends a closed event even when project_watch row is already stopped', async () => {
    db.prepare(`
      INSERT INTO project_watch (
        project_id, state, origin, version, generation, revision, auto_start_blocked,
        offers_capped, failures
      ) VALUES (1, 'stopped', 'list', 1, 1, 1, 0, 0, 0);
    `).run()

    const eClosed = insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'in_progress', to: 'closed' }
    })

    let sentText = ''
    const out = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps({
        sendSingle: async (p) => {
          sentText = p.text
          return true
        }
      })
    )

    expect(out.results[0]?.result).toBe('sent')
    expect(sentText).toBe('The project was closed — watching stopped')

    const row = db
      .prepare('SELECT status FROM notification_events WHERE id = ?;')
      .get(eClosed) as { status: string }
    expect(row.status).toBe('submitted')
  })

  it('maps outcome.change correctly for all four changes (contact_sure, contact_maybe, status_in_progress, status_closed)', async () => {
    insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_contact',
      payload: { v: 1, from: 0, to: 1, attribution: 'sure', clientOpen: null }
    })
    insertWatchEvent(db, {
      projectId: 2,
      kind: 'watch_contact',
      payload: { v: 1, from: 0, to: 1, attribution: 'maybe', clientOpen: null }
    })
    insertWatchEvent(db, {
      projectId: 3,
      kind: 'watch_status',
      payload: { v: 1, from: 'open', to: 'in_progress' }
    })
    insertWatchEvent(db, {
      projectId: 4,
      kind: 'watch_status',
      payload: { v: 1, from: 'in_progress', to: 'closed' }
    })
    // completed also maps to status_closed
    insertWatchEvent(db, {
      projectId: 1,
      kind: 'watch_status',
      payload: { v: 1, from: 'in_progress', to: 'completed' }
    })

    const out = await dispatchWatchPending(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:00:01.000Z', lang: 'en' },
      defaultDeps()
    )

    expect(out.results.map((r) => r.change)).toEqual([
      'contact_sure',
      'contact_maybe',
      'status_in_progress',
      'status_closed',
      'status_closed'
    ])
  })
})
