import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { getProjectById, getSourceState, listEventsByStatus } from '../src/storage/repositories.js'
import { applyFailedCycle, applySuccessfulCycle, evaluateLateProject } from '../src/collector/pipeline.js'
import { normalizeItems } from '../src/collector/normalize.js'
import type { RawRssItem } from '../src/collector/rss.js'
import { defaultSettings } from '../src/shared/types.js'

let dir = ''
let db: Db

const raw = (ids: string[]): RawRssItem[] =>
  ids.map((id) => ({ title: `t${id}`, link: `https://mostaql.com/go/${id}`, description: 'd', pubDateRaw: null }))

const ctx = (extra: Partial<Parameters<typeof applySuccessfulCycle>[2]> = {}) => ({
  nowIso: '2026-09-24T14:00:00.000Z',
  nowMs: Date.parse('2026-09-24T14:00:00.000Z'),
  runId: 'run-1',
  settings: defaultSettings(),
  durationMs: 300,
  itemCount: 1,
  invalidSingles: 0,
  firstCycleOfRun: false,
  ...extra
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-pipe-'))
  db = openDatabase(join(dir, 't.db'))
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('pipeline', () => {
  it('first success stores the baseline with zero notifications', () => {
    const items = normalizeItems(raw(['1', '2'])).valid
    const out = applySuccessfulCycle(db, items, ctx({ firstCycleOfRun: true }))
    expect(out.baseline).toBe(true)
    expect(out.insertedIds).toHaveLength(2)
    expect(out.notifyProjectIds).toHaveLength(0)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(0)
    expect(getSourceState(db, 'mostaql').baselineComplete).toBe(true)
    expect(getProjectById(db, out.insertedIds[0]!)?.discoveryKind).toBe('initial')
  })

  it('detects genuinely new ids and ignores repeats/reorders', () => {
    const first = normalizeItems(raw(['1', '2'])).valid
    applySuccessfulCycle(db, first, ctx({ firstCycleOfRun: true }))
    const second = normalizeItems(raw(['2', '1', '3'])).valid
    const out = applySuccessfulCycle(
      db,
      second,
      ctx({ nowIso: '2026-09-24T14:00:10.000Z', nowMs: Date.parse('2026-09-24T14:00:10.000Z') })
    )
    expect(out.baseline).toBe(false)
    expect(out.insertedIds).toHaveLength(1)
    expect(out.notifyProjectIds).toHaveLength(1)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(1)
  })

  it('marks finds after a restart/gap as recovered, not live', () => {
    applySuccessfulCycle(db, normalizeItems(raw(['1'])).valid, ctx({ firstCycleOfRun: true }))
    const out = applySuccessfulCycle(
      db,
      normalizeItems(raw(['1', '9'])).valid,
      ctx({ nowIso: '2026-09-24T16:00:00.000Z', nowMs: Date.parse('2026-09-24T16:00:00.000Z'), firstCycleOfRun: true, runId: 'run-2' })
    )
    const p = getProjectById(db, out.insertedIds[0]!)
    expect(p?.discoveryKind).toBe('recovered')
  })

  it('title edits update silently without new discovery events', () => {
    applySuccessfulCycle(db, normalizeItems(raw(['1'])).valid, ctx({ firstCycleOfRun: true }))
    const edited: RawRssItem[] = [{ title: 't1 EDITED', link: 'https://mostaql.com/go/1', description: 'd2', pubDateRaw: null }]
    const out = applySuccessfulCycle(db, normalizeItems(edited).valid, ctx({ nowMs: Date.parse('2026-09-24T14:00:10.000Z') }))
    expect(out.insertedIds).toHaveLength(0)
    expect(out.updatedIds).toHaveLength(1)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(0)
  })

  it('a failed cycle never creates a baseline or wipes data', () => {
    applyFailedCycle(db, { nowIso: '2026-09-24T14:00:00.000Z', errorCategory: 'timeout', detail: null, durationMs: 10000, runId: 'run-1' })
    expect(getSourceState(db, 'mostaql').baselineComplete).toBe(false)
    expect(getSourceState(db, 'mostaql').consecutiveFailures).toBe(1)
  })

  it('holds uncertain-category projects for enrichment instead of generic pings', () => {
    applySuccessfulCycle(db, normalizeItems(raw(['1'])).valid, ctx({ firstCycleOfRun: true }))
    const s = defaultSettings()
    s.notifyFilter = { mode: 'selected', categories: ['design'], keywordsAny: [], keywordsAll: [], excludeKeywords: [] }
    const out = applySuccessfulCycle(
      db,
      normalizeItems(raw(['1', '2'])).valid,
      ctx({ nowMs: Date.parse('2026-09-24T14:00:10.000Z'), settings: s })
    )
    // default notifyUncertainCategory=false -> no pending, one wait registered
    expect(out.notifyProjectIds).toHaveLength(0)
    expect(out.uncertainWaits.has(out.insertedIds[0]!)).toBe(true)
    // late classification with matching category notifies exactly once
    const lateId = out.insertedIds[0] as number
    db.prepare('UPDATE projects SET category_slug=?, category_name=?, category_confirmed=1 WHERE id=?;').run('design', 'تصميم', lateId)
    expect(evaluateLateProject(db, lateId, s, '2026-09-24T14:00:20.000Z')).toBe('notify')
    expect(listEventsByStatus(db, 'pending')).toHaveLength(1)
    // late non-matching data stays silent (filter asks for business, project is design)
    const s2 = defaultSettings()
    s2.notifyFilter = { mode: 'selected', categories: ['business'], keywordsAny: [], keywordsAll: [], excludeKeywords: [] }
    expect(evaluateLateProject(db, lateId, s2, '2026-09-24T14:00:21.000Z')).toBe('silent')
  })
})
