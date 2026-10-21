import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../src/storage/db.js'
import { queryProjectsPage, updateUserState, upsertProjectDetails, upsertProjectsBatch } from '../src/storage/repositories.js'
import { queryMatchingIds } from '../src/storage/projectQuery.js'
import { rebuildSearchBatch, resetSearchCache, searchCacheReady } from '../src/storage/searchCache.js'
import { defaultFilterDefinition, sanitizeFilterDefinition, type FilterDefinition } from '../src/shared/types.js'
import { containsGeneralSearch, foldForSearch, normalizeGeneralSearch } from '../src/shared/searchText.js'
import { saveProposalDraft } from '../src/storage/proposalDrafts.js'

let db: Db, folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'rased-test-search-')); db = openDatabase(join(folder, 'rased.db'))
  upsertProjectsBatch(db, Array.from({ length: 24 }, (_, i) => ({ source: (['mostaql', 'khamsat', 'nafezly', 'kaf'] as const)[i % 4]!, externalId: String(i), url: 'https://example.invalid/' + i, title: i % 2 ? 'React 100%_ literal' : 'إِدَارَة ١٢', descriptionExcerpt: i % 3 ? 'excerpt' : 'alpha beta', publishedAt: i % 5 ? '2026-10-21T01:00:00Z' : 'invalid', publishedRaw: null })), { now: '2026-10-21T02:00:00Z', discoveryKind: 'live' })
  for (let id = 1; id <= 24; id++) {
    db.prepare('UPDATE projects SET budget_min=?,budget_max=?,category_confirmed=?,category_slug=?,read_at=?,skills_json=? WHERE id=?').run(id % 3 ? id : null, id % 3 ? id + 25 : null, id % 2, id % 3 ? 'development' : 'design', id % 2 ? null : '2026-10-21T02:00:00Z', id === 1 ? 'malformed' : '["TypeScript"]', id)
    updateUserState(db, id, { saved: id % 2 === 0, hidden: id % 5 === 0, status: id % 3 ? 'interested' : 'ignored', note: id === 1 ? 'سِرّ ملاحظتي' : '' })
  }
  upsertProjectDetails(db, 1, { text: 'OnlyCachedBody café', provenance: 'full', fetchedAt: null, status: 'ready', errorCode: null })
  saveProposalDraft(db, { projectId: 2, proposal: 'PrivateDraft', assumptions: [], questions: [], updatedAt: '2026-10-21T02:00:00Z' })
})
afterEach(() => { db.close(); rmSync(folder, { recursive: true, force: true }) })
const page = (patch: Partial<FilterDefinition> = {}, limit = 200, offset = 0) => queryProjectsPage(db, { ...defaultFilterDefinition(), ...patch }, { limit, offset })
function warm(): void { while (!rebuildSearchBatch(db).complete) { /* bounded synchronous test fixture */ } }

describe('search text and SQL semantics', () => {
  it('normalizes Arabic and NFC, collapses whitespace, and preserves legacy keyword folding', () => {
    for (const [value, needle] of [['ABC\n DEF', 'bc'], ['ABC\n DEF', 'c d'], ['tailOnly٠', 'tailonly0'], ['إِدَارَة ١٢', 'اداره 12'], ['🙂ab', '🙂a']]) expect(containsGeneralSearch(value!, needle!)).toBe(normalizeGeneralSearch(value!).includes(needle!))
    expect(normalizeGeneralSearch('إِدَارَة\t ١٢')).toBe('اداره 12')
    expect(normalizeGeneralSearch('cafe\u0301')).toBe(normalizeGeneralSearch('café'))
    expect(foldForSearch('A  B')).toBe('a  b')
    expect(page({ search: 'اداره 12' }).total).toBeGreaterThan(0)
    expect(page({ search: '%_' }).total).toBe(10) // Literal substring, not SQL wildcards.
    expect(page({ search: "' OR 1=1--" }).total).toBe(0)
    expect(page({ search: 'React 100' }).rows.every(p => p.title.includes('React'))).toBe(true)
    expect(page({ search: 'React excerpt' }).total).toBe(0) // No cross-field concatenation.
  })
  it('searches only cached descriptions, and private fields only when explicitly enabled', () => {
    expect(page({ search: 'OnlyCachedBody' }).rows.map(p => p.id)).toEqual([1])
    expect(page({ search: 'cafe\u0301' }).rows[0]?.matchedFields).toEqual(['body'])
    expect(page({ search: 'ملاحظتي' }).total).toBe(0)
    expect(page({ search: 'ملاحظتي', searchInNotes: true }).rows[0]?.matchedFields).toEqual(['note'])
    expect(page({ search: 'PrivateDraft' }).total).toBe(0)
    const result = page({ search: 'PrivateDraft', searchInDrafts: true })
    expect(result.rows.map(p => p.id)).toEqual([2])
    expect(result.rows[0]?.matchedFields).toEqual(['draft'])
    expect(JSON.stringify(result)).not.toContain('PrivateDraft')
    expect(JSON.stringify(result)).not.toContain('proposal')
    warm()
    const cache = JSON.stringify([...db.prepare('SELECT * FROM project_search_cache').all(), ...db.prepare('SELECT * FROM project_search_body').all()]).toLowerCase()
    expect(cache).not.toContain('privatedraft'); expect(cache).not.toContain('ملاحظتي')
    db.exec("CREATE VIRTUAL TABLE temp.search_vocab USING fts5vocab(main,project_search_fts,'row')")
    expect(db.prepare("SELECT COUNT(*) AS n FROM temp.search_vocab WHERE term IN ('pri','ملا')").get()!.n).toBe(0)
    expect(sanitizeFilterDefinition({}).searchInNotes).toBe(false)
    expect(sanitizeFilterDefinition({ searchInDrafts: 'true' }).searchInDrafts).toBe(false)
  })
  it('preserves empty-fold any/all/exclusion and category uncertainty rules', () => {
    const f = defaultFilterDefinition().categoryFilter
    expect(page({ categoryFilter: { ...f, keywordsAny: ['ـَ'] } }).total).toBe(0)
    expect(page({ categoryFilter: { ...f, keywordsAll: ['ـَ'], excludeKeywords: ['ـَ'] } }).total).toBe(page().total)
    const selected = page({ categoryFilter: { ...f, mode: 'selected', categories: ['development'] } })
    expect(selected.rows.every(p => p.source === 'mostaql' && (!p.categoryConfirmed || p.categorySlug === 'development'))).toBe(true)
  })
  it('matches an independent scalar oracle across scopes, sources, budgets and paging before/after cache', () => {
    const raw = db.prepare('SELECT p.*,u.saved_at,u.hidden_at,u.personal_status FROM projects p LEFT JOIN project_user_state u ON u.project_id=p.id').all() as Record<string, string | number | null>[]
    for (const cached of [false, true]) {
      if (cached) warm()
      for (const scope of ['all', 'saved', 'hidden'] as const) for (const source of ['all', 'mostaql', 'khamsat', 'nafezly', 'kaf'] as const) for (const unreadOnly of [false, true]) for (const includeUnknownBudget of [false, true]) {
        const def = { ...defaultFilterDefinition(), scope, source, unreadOnly, includeUnknownBudget, budgetMin: 12, budgetMax: 30 }
        const matches = raw.filter(p => (source === 'all' || p.source === source) && (scope === 'hidden' ? !!p.hidden_at : !p.hidden_at) && (scope !== 'saved' || !!p.saved_at) && (!unreadOnly || !p.read_at) && (p.budget_min === null ? includeUnknownBudget : Number(p.budget_max) >= 12 && Number(p.budget_min) <= 30)).sort((a, b) => Number(b.id) - Number(a.id))
        const actual = queryProjectsPage(db, def, { limit: 3, offset: 1 })
        expect(actual.rows.map(p => p.id)).toEqual(matches.slice(1, 4).map(p => p.id))
        expect(actual.total).toBe(matches.length); expect(actual.unread).toBe(matches.filter(p => !p.read_at).length)
        expect(queryMatchingIds(db, def, [1, 2, 3, 4]).sort()).toEqual(matches.filter(p => Number(p.id) <= 4).map(p => Number(p.id)).sort())
      }
    }
  })
  it('orders timestamps by epoch, breaks ties by id, and returns counts on an empty offset', () => {
    db.prepare('UPDATE projects SET published_at=? WHERE id=1').run('2026-10-20T23:30:00-03:00')
    expect(page({ sort: 'latestPublished' }).rows[0]?.id).toBe(1)
    const p = page({}, 10, 1000)
    expect(p.rows).toEqual([]); expect(p.total).toBe(20); expect(p.unread).toBe(10)
    expect(page({}, 0).rows).toEqual([])
  })
})

describe('incremental cache and live windows', () => {
  it('keeps cold/partial/warm results identical and invalidates raw SQL and UPSERT bodies', () => {
    const cold = page({ search: 'OnlyCachedBody' }); rebuildSearchBatch(db, 3)
    expect(page({ search: 'OnlyCachedBody' })).toEqual(cold)
    warm(); expect(page({ search: 'OnlyCachedBody' })).toEqual(cold); expect(searchCacheReady(db)).toBe(true)
    upsertProjectDetails(db, 1, { text: 'ChangedBody', provenance: 'full', fetchedAt: null, status: 'ready', errorCode: null })
    expect(searchCacheReady(db)).toBe(false); expect(page({ search: 'OnlyCachedBody' }).total).toBe(0)
    expect(page({ search: 'ChangedBody' }).rows.map(p => p.id)).toEqual([1])
    warm(); db.exec("UPDATE projects SET title='RawChanged' WHERE id=1")
    expect(page({ search: 'RawChanged' }).total).toBe(1)
    warm(); db.exec('DELETE FROM project_details WHERE project_id=1')
    expect(page({ search: 'ChangedBody' }).total).toBe(0)
    resetSearchCache(db); expect(page({ search: 'RawChanged' }).total).toBe(1)
    warm(); db.exec('DELETE FROM projects WHERE id=1')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('SELECT 1 FROM project_search_cache WHERE project_id=1').get()).toBeUndefined()
  })
  it('retains exact substring semantics with FTS candidates and Unicode short keys', () => {
    db.prepare('UPDATE projects SET title=? WHERE id=1').run('Literal "quoted" 100%_ 🙂ab punct:+ café é')
    upsertProjectDetails(db, 1, { text: 'سطر جديد abc-def café 🙂xy مؤسَّسة ٢٣ special space', provenance: 'full', fetchedAt: null, status: 'ready', errorCode: null })
    const needles = ['quoted', '"quoted"', '100%_', '🙂', '🙂a', '🙂ab', 'ab', 'b', 'abc-def', 'café', 'é', '23', 'مؤسسة', ':+', 'special space', 'not-here', 'café 🙂xy']
    const expected = needles.map(search => page({ search }).rows.map(p => p.id))
    warm()
    needles.forEach((search, index) => expect(page({ search }).rows.map(p => p.id), search).toEqual(expected[index]))
  })
  it('falls back when an individual derived body or candidate-index row is absent', () => {
    warm(); db.exec('DELETE FROM project_search_fts WHERE rowid=1; DELETE FROM project_search_body WHERE project_id=1')
    expect(page({ search: 'OnlyCachedBody' }).rows.map(p => p.id)).toEqual([1])
    expect(page({ search: 'OnlyCachedBody' }).rows[0]?.matchedFields).toEqual(['body'])
  })
  it('rolls back a failed derived rebuild without losing originals or dirty work', () => {
    db.exec("CREATE TRIGGER synthetic_cache_failure BEFORE INSERT ON project_search_cache BEGIN SELECT RAISE(ABORT,'fixture'); END")
    expect(() => rebuildSearchBatch(db)).toThrow('fixture')
    expect(db.prepare('SELECT COUNT(*) AS n FROM projects').get()!.n).toBe(24)
    expect(db.prepare('SELECT COUNT(*) AS n FROM project_search_dirty').get()!.n).toBe(24)
    expect(db.prepare('SELECT COUNT(*) AS n FROM project_search_cache').get()!.n).toBe(0)
    db.exec('DROP TRIGGER synthetic_cache_failure'); warm()
    expect(searchCacheReady(db)).toBe(true)
  })
  it('keeps new arrivals deferred across changes to older matching rows', () => {
    const original = page(), def = defaultFilterDefinition()
    upsertProjectsBatch(db, [{ source: 'mostaql', externalId: 'new', url: 'https://example.invalid/new', title: 'new', descriptionExcerpt: '', publishedAt: null, publishedRaw: null }], { now: '2026-10-21T03:00:00Z', discoveryKind: 'live' })
    updateUserState(db, 1, { note: 'updated' })
    const unchangedWindow = queryProjectsPage(db, def, { limit: 50, offset: 0 }, { ceilingId: original.ceilingId })
    expect(unchangedWindow.total).toBe(original.total + 1); expect(unchangedWindow.visibleTotal).toBe(original.total)
    expect(unchangedWindow.rows.map(p => p.id)).not.toContain(25)
    expect(page().rows[0]?.id).toBe(25)
  })
})

