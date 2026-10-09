import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { SCHEMA_VERSION } from '../src/storage/migrations.js'
import {
  addTombstones,
  countProjects,
  countPurgeable,
  deleteSavedFilterRow,
  filterOutTombstoned,
  getProjectDetailsRow,
  getUserState,
  listProjects,
  listSavedFilters,
  purgeHistory,
  queryProjectsPage,
  saveSavedFilterRow,
  updateEnrichment,
  updateUserState,
  upsertProjectsBatch,
  upsertProjectDetails,
  type UpsertInput
} from '../src/storage/repositories.js'
import {
  defaultFilterDefinition,
  sanitizeFilterDefinition,
  sanitizeSavedFilter,
  sanitizeSettings,
  sanitizeUserStatePatch,
  type FilterDefinition,
  type SavedFilter
} from '../src/shared/types.js'

let dir = ''
let db: Db

const item = (id: string, title = `title ${id}`): UpsertInput => ({
  source: 'mostaql',
  externalId: id,
  url: `https://mostaql.com/go/${id}`,
  title,
  descriptionExcerpt: `excerpt ${id} React`,
  publishedAt: '2026-09-24T13:00:00.000Z',
  publishedRaw: 'x'
})

function seed(n: number, now = '2026-09-24T14:00:00.000Z', start = 1000): number[] {
  const ids: string[] = []
  for (let i = 1; i <= n; i++) ids.push(String(start + i))
  return upsertProjectsBatch(db, ids.map((id) => item(id)), { now, discoveryKind: 'live' }).insertedIds
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-v2-'))
  db = openDatabase(join(dir, 't.db'))
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('migration v3', () => {
  it('creates v3 tables and preserves stored data across reopen', () => {
    expect(SCHEMA_VERSION).toBe(7)
    const ids = seed(3)
    updateUserState(db, ids[0] as number, { saved: true, note: 'keep me' })
    const path = join(dir, 't.db')
    closeDatabase(db)
    db = openDatabase(path)
    expect(countProjects(db, {}).total).toBe(3)
    const u = getUserState(db, ids[0] as number)
    expect(u.savedAt).not.toBeNull()
    expect(u.note).toBe('keep me')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all() as unknown as { name: string }[]
    for (const t of ['project_user_state', 'project_details', 'saved_filters', 'tombstones', 'pending_classifications']) {
      expect(tables.map((x) => x.name)).toContain(t)
    }
  })

  it('supports online VACUUM INTO backup with intact data', () => {
    seed(2)
    const backup = join(dir, 'backup.db')
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)
    const b = openDatabase(backup)
    try {
      expect(countProjects(b, {}).total).toBe(2)
    } finally {
      closeDatabase(b)
    }
  })
})

describe('user state', () => {
  it('saves/unsaves/hides/statuses/notes with stable timestamps', () => {
    const [id] = seed(1)
    const pid = id as number
    expect(getUserState(db, pid).status).toBe('none')
    expect(updateUserState(db, 9999, { saved: true })).toBe(false)
    expect(updateUserState(db, pid, { saved: true, status: 'interested', note: 'n1' })).toBe(true)
    const a = getUserState(db, pid)
    expect(a.savedAt).not.toBeNull()
    expect(a.status).toBe('interested')
    expect(updateUserState(db, pid, { status: 'submitted' })).toBe(true)
    const b = getUserState(db, pid)
    expect(b.savedAt).toBe(a.savedAt) // partial update keeps savedAt
    expect(b.status).toBe('submitted')
    expect(updateUserState(db, pid, { saved: false, hidden: true })).toBe(true)
    const c = getUserState(db, pid)
    expect(c.savedAt).toBeNull()
    expect(c.hiddenAt).not.toBeNull()
  })
})

describe('details cache', () => {
  it('round-trips ready/failed states', () => {
    const [id] = seed(1)
    const pid = id as number
    expect(getProjectDetailsRow(db, pid).status).toBe('not_requested')
    upsertProjectDetails(db, pid, { text: 'full body', provenance: 'full', fetchedAt: '2026-09-24T15:00:00.000Z', status: 'ready', errorCode: null })
    expect(getProjectDetailsRow(db, pid).text).toBe('full body')
    upsertProjectDetails(db, pid, { text: null, provenance: null, fetchedAt: null, status: 'failed', errorCode: 'http-404' })
    expect(getProjectDetailsRow(db, pid).errorCode).toBe('http-404')
  })
})

describe('saved filters', () => {
  const def = (): FilterDefinition => ({ ...defaultFilterDefinition(), search: 'React' })
  it('creates/updates/deletes and skips corrupt rows', () => {
    const now = '2026-09-24T14:00:00.000Z'
    const f: SavedFilter = { id: 'sf_abc', name: 'mine', definition: def(), createdAt: now, updatedAt: now }
    saveSavedFilterRow(db, f)
    expect(listSavedFilters(db)).toHaveLength(1)
    saveSavedFilterRow(db, { ...f, name: 'renamed', updatedAt: '2026-09-25T00:00:00.000Z' })
    const [got] = listSavedFilters(db)
    expect(got?.name).toBe('renamed')
    expect(got?.createdAt).toBe(now) // createdAt preserved
    expect(deleteSavedFilterRow(db, 'sf_nope')).toBe(false)
    expect(deleteSavedFilterRow(db, 'sf_abc')).toBe(true)
    expect(listSavedFilters(db)).toHaveLength(0)
    db.prepare("INSERT INTO saved_filters (id, name, definition_json, created_at, updated_at) VALUES ('sf_bad','x','{oops',?,?);").run(now, now)
    expect(listSavedFilters(db)).toHaveLength(0)
  })
})

describe('tombstones + purge', () => {
  it('purges only old unremarkable projects and tombstones them', () => {
    const ids = seed(5, '2026-09-01T00:00:00.000Z')
    const [a, b, c, d] = ids as [number, number, number, number, number]
    // 5th project (external 1005) stays plain+old -> the single purge victim
    updateUserState(db, a, { saved: true })
    updateUserState(db, b, { note: 'has note' })
    updateUserState(db, c, { status: 'interested' })
    updateUserState(db, d, { status: 'submitted' })
    // e is plain and old -> purged; fresh projects are never purged
    seed(2, '2026-09-24T14:00:00.000Z', 2000)
    expect(countPurgeable(db, '2026-09-20T00:00:00.000Z', ['initial', 'live', 'recovered'])).toBe(1)
    const { deleted } = purgeHistory(db, '2026-09-20T00:00:00.000Z', ['initial', 'live', 'recovered'])
    expect(deleted).toBe(1)
    expect(countProjects(db, {}).total).toBe(6)
    // tombstoned external id never resurrects through the filter
    const back = filterOutTombstoned(db, [{ source: 'mostaql', externalId: '1005' }])
    expect(back).toHaveLength(0)
    expect(filterOutTombstoned(db, [{ source: 'mostaql', externalId: '9999' }])).toHaveLength(1)
    addTombstones(db, 'mostaql', [])
  })
})

describe('query engine', () => {
  function seedRich(): number[] {
    const ids = seed(60)
    ids.forEach((id, i) => {
      const slug = i % 3 === 0 ? 'design' : i % 3 === 1 ? 'development' : null
      updateEnrichment(
        db,
        id,
        {
          categorySlug: slug,
          categoryName: slug,
          categoryConfirmed: slug !== null,
          skills: i % 2 === 0 ? ['React'] : ['WordPress'],
          budgetMin: i % 4 === 0 ? null : 50 + i,
          budgetMax: i % 4 === 0 ? null : 150 + i,
          currency: i % 4 === 0 ? null : 'USD',
          budgetRaw: null,
          status: 'ready'
        },
        '2026-09-24T15:00:00.000Z'
      )
      if (i % 5 === 0) updateUserState(db, id, { saved: true })
      if (i % 7 === 0) updateUserState(db, id, { hidden: true })
      if (i % 6 === 0) updateUserState(db, id, { status: 'ignored' })
    })
    return ids
  }

  it('applies every constraint before pagination and count, list===count', () => {
    seedRich()
    const def: FilterDefinition = {
      ...defaultFilterDefinition(),
      statuses: ['ignored'],
      search: 'React',
      categoryFilter: { mode: 'selected', categories: ['design'], keywordsAny: [], keywordsAll: [], excludeKeywords: [] },
      budgetMin: 60,
      budgetMax: 200,
      sort: 'latestDetected'
    }
    const full = queryProjectsPage(db, def, { limit: 1000, offset: 0 })
    const page1 = queryProjectsPage(db, def, { limit: 10, offset: 0 })
    const page2 = queryProjectsPage(db, def, { limit: 10, offset: 10 })
    expect(page1.total).toBe(full.total)
    expect(page2.total).toBe(full.total)
    expect([...page1.rows, ...page2.rows].map((r) => r.id)).toEqual(full.rows.slice(0, 20).map((r) => r.id))
    for (const r of full.rows) {
      expect(r.personalStatus).toBe('ignored')
      expect(r.hidden).toBe(false)
    }
    // legacy wrappers agree with the engine
    expect(countProjects(db, {}).total).toBe(queryProjectsPage(db, defaultFilterDefinition(), { limit: 0, offset: 0 }).total)
    expect(listProjects(db, { limit: 5, offset: 0 }).map((p) => p.id)).toEqual(
      queryProjectsPage(db, defaultFilterDefinition(), { limit: 5, offset: 0 }).rows.map((r) => r.id)
    )
  })

  it('pages a 250-row store with stable database windows', () => {
    seed(250, '2026-09-24T14:00:00.000Z', 5000)
    const def = defaultFilterDefinition()
    const w1 = queryProjectsPage(db, def, { limit: 200, offset: 0 })
    const w2 = queryProjectsPage(db, def, { limit: 200, offset: 50 })
    const w3 = queryProjectsPage(db, def, { limit: 200, offset: 200 })
    expect(w1.total).toBe(250)
    expect(w1.rows).toHaveLength(200)
    expect(w2.rows).toHaveLength(200)
    expect(w3.rows).toHaveLength(50)
    // overlapping windows agree on shared ids (no duplication/shift)
    expect(w1.rows.slice(50, 60).map((r) => r.id)).toEqual(w2.rows.slice(0, 10).map((r) => r.id))
    // filtered totals still match across pages
    const fdef: FilterDefinition = { ...defaultFilterDefinition(), search: 'title 50' }
    const f = queryProjectsPage(db, fdef, { limit: 200, offset: 0 })
    expect(f.total).toBeGreaterThan(0)
    expect(f.rows.length).toBeLessThanOrEqual(200)
  })

  it('handles scopes, unknown budgets and published ties deterministically', () => {
    seedRich()
    const saved = queryProjectsPage(db, { ...defaultFilterDefinition(), scope: 'saved' }, { limit: 1000, offset: 0 })
    expect(saved.total).toBeGreaterThan(0)
    expect(saved.rows.every((r) => r.saved)).toBe(true)
    const hidden = queryProjectsPage(db, { ...defaultFilterDefinition(), scope: 'hidden' }, { limit: 1000, offset: 0 })
    expect(hidden.rows.every((r) => r.hidden)).toBe(true)
    const all = queryProjectsPage(db, defaultFilterDefinition(), { limit: 1000, offset: 0 })
    expect(all.rows.some((r) => r.hidden)).toBe(false)
    const strict = queryProjectsPage(db, { ...defaultFilterDefinition(), includeUnknownBudget: false }, { limit: 1000, offset: 0 })
    const loose = queryProjectsPage(db, { ...defaultFilterDefinition(), includeUnknownBudget: true }, { limit: 1000, offset: 0 })
    expect(loose.total).toBeGreaterThan(strict.total)
    const pub = queryProjectsPage(db, { ...defaultFilterDefinition(), sort: 'latestPublished' }, { limit: 1000, offset: 0 })
    expect(pub.rows.length).toBe(all.rows.length)
    // tie-break by id desc is deterministic
    const ids = pub.rows.map((r) => r.id)
    expect(ids).toEqual([...ids].sort((a, b) => b - a))
  })
})

describe('sanitizers', () => {
  it('extends settings with safe v2 defaults', () => {
    const s = sanitizeSettings({})
    expect(s.linkDisplayAndNotifyFilters).toBe(false)
    expect(s.doNotDisturbUntil).toBeNull()
    expect(s.ui.theme).toBe('dark')
    expect(s.ui.closeBehavior).toBe('tray')
    const bad = sanitizeSettings({ doNotDisturbUntil: 'not-a-date', ui: { theme: 'neon', textScale: 999, previewRatio: 99, closeBehavior: 'explode' } })
    expect(bad.doNotDisturbUntil).toBeNull()
    expect(bad.ui.theme).toBe('dark')
    expect(bad.ui.textScale).toBe(100)
    expect(bad.ui.previewRatio).toBe(0.6)
    expect(sanitizeSettings({ ui: { previewRatio: 0.45 } }).ui.previewRatio).toBe(0.32)
    expect(sanitizeSettings({ ui: { previewRatio: 0.45, previewLayoutVersion: 2 } }).ui.previewRatio).toBe(0.45)
    expect(bad.ui.closeBehavior).toBe('tray')
  })

  it('validates saved filters, definitions and user patches', () => {
    expect(sanitizeSavedFilter(null)).toBeNull()
    expect(sanitizeSavedFilter({ id: 'bad id!', name: 'x', definition: {} })).toBeNull()
    expect(sanitizeSavedFilter({ id: 'sf_1', name: '   ', definition: {} })).toBeNull()
    const longName = sanitizeSavedFilter({ id: 'sf_1', name: 'ok', definition: { budgetMin: 200, budgetMax: 100 } })
    expect(longName?.definition.budgetMax).toBe(200) // min>max collapses to min
    const def = sanitizeFilterDefinition({ scope: 'nope', statuses: ['interested', 'bogus'], sort: 'nope', search: 42 })
    expect(def.scope).toBe('all')
    expect(def.statuses).toEqual(['interested'])
    expect(def.sort).toBe('latestDetected')
    expect(def.search).toBe('')
    expect(sanitizeUserStatePatch({ note: 'x'.repeat(5001) })).toBeNull()
    expect(sanitizeUserStatePatch({ status: 'bogus' })).toBeNull()
    expect(sanitizeUserStatePatch({ saved: 'yes' })).toBeNull()
    expect(sanitizeUserStatePatch({ saved: true, hidden: false })?.saved).toBe(true)
    expect(sanitizeUserStatePatch({})).toEqual({})
  })
})
