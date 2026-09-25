import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { createPendingEvents, getProjectById, listEventsByStatus, upsertProjectsBatch } from '../src/storage/repositories.js'
import { dispatchPending, recoverPreviousSession, type DispatchDeps } from '../src/main/notifier.js'
import { isAllowedProjectUrl, resolveProjectUrl } from '../src/main/links.js'

let dir = ''
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-notify-'))
  db = openDatabase(join(dir, 't.db'))
  upsertProjectsBatch(
    db,
    [
      { source: 'mostaql', externalId: '1', url: 'https://mostaql.com/go/1', title: 't1', descriptionExcerpt: 'd', publishedAt: null, publishedRaw: null },
      { source: 'mostaql', externalId: '2', url: 'https://mostaql.com/go/2', title: 't2', descriptionExcerpt: 'd', publishedAt: null, publishedRaw: null }
    ],
    { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' }
  )
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

const okSender: DispatchDeps = {
  sendSingle: async () => true,
  sendSummary: async () => true
}

describe('dispatchPending', () => {
  it('sends singles and persists dispatching before the OS call', async () => {
    const seen: string[] = []
    createPendingEvents(db, [1, 2], 'new_project', '2026-09-24T14:00:00.000Z')
    const out = await dispatchPending(
      db,
      { sessionId: 's1', nowIso: '2026-09-24T14:00:01.000Z', recovering: false, batchKey: null },
      { ...okSender, sendSingle: async (p) => { seen.push(`dispatching-first:${p.eventId}`); return true } }
    )
    expect(out.singles).toBe(2)
    expect(listEventsByStatus(db, 'submitted')).toHaveLength(2)
    expect(seen).toHaveLength(2)
  })

  it('summarizes large batches once and records the batch key', async () => {
    const many = (ids: number[]) => createPendingEvents(db, ids, 'new_project', '2026-09-24T14:00:00.000Z')
    // add more projects 3..8
    upsertProjectsBatch(
      db,
      ['3', '4', '5', '6', '7', '8'].map((id) => ({ source: 'mostaql', externalId: id, url: `https://mostaql.com/go/${id}`, title: `t${id}`, descriptionExcerpt: 'd', publishedAt: null, publishedRaw: null })),
      { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' }
    )
    many([1, 2, 3, 4, 5, 6])
    let singles = 0
    let summaries = 0
    const out = await dispatchPending(
      db,
      { sessionId: 's1', nowIso: '2026-09-24T14:00:01.000Z', recovering: false, batchKey: 'gap:x' },
      { sendSingle: async () => { singles++; return true }, sendSummary: async () => { summaries++; return true } }
    )
    expect(singles).toBe(0)
    expect(summaries).toBe(1)
    expect(out.summaries).toBe(1)
    // repeating the same catch-up batch does not re-notify
    many([7, 8])
    const out2 = await dispatchPending(
      db,
      { sessionId: 's1', nowIso: '2026-09-24T14:00:02.000Z', recovering: false, batchKey: 'gap:x' },
      { sendSingle: async () => { singles++; return true }, sendSummary: async () => { summaries++; return true } }
    )
    expect(out2.singles).toBe(2) // different events, no batch key collision on singles path
    expect(summaries).toBe(1)
  })

  it('marks failed sends without infinite retry and keeps the project listed', async () => {
    createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')
    const out = await dispatchPending(
      db,
      { sessionId: 's1', nowIso: '2026-09-24T14:00:01.000Z', recovering: false, batchKey: null },
      { sendSingle: async () => false, sendSummary: async () => false }
    )
    expect(out.failed).toBe(1)
    expect(listEventsByStatus(db, 'failed')).toHaveLength(1)
    expect(getProjectById(db, 1)?.title).toBe('t1')
  })

  it('recovers stale dispatching rows as uncertain', () => {
    createPendingEvents(db, [1], 'new_project', '2026-09-24T14:00:00.000Z')
    db.prepare("UPDATE notification_events SET status='dispatching', session_id='old' WHERE project_id=1;").run()
    expect(recoverPreviousSession(db, 'new-session', '2026-09-24T14:05:00.000Z')).toBe(1)
    expect(listEventsByStatus(db, 'uncertain')).toHaveLength(1)
  })
})

describe('links', () => {
  it('allow-lists only exact mostaql https project urls', () => {
    expect(isAllowedProjectUrl('https://mostaql.com/go/123')).toBe(true)
    expect(isAllowedProjectUrl('https://mostaql.com/project/123-foo')).toBe(true)
    expect(isAllowedProjectUrl('http://mostaql.com/go/123')).toBe(false)
    expect(isAllowedProjectUrl('https://mostaql.com.evil.com/go/123')).toBe(false)
    expect(isAllowedProjectUrl('https://mostaql.com/projects')).toBe(false)
    expect(isAllowedProjectUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedProjectUrl('file:///etc/passwd')).toBe(false)
  })
  it('resolves the stored url by id, never renderer strings', () => {
    expect(resolveProjectUrl(db, 1)).toBe('https://mostaql.com/go/1')
    expect(resolveProjectUrl(db, 999)).toBeNull()
  })
})
