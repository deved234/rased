import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../src/storage/db.js'
import { createPendingEvents, getProjectDetailsRow, getSettingRaw, getUserState, listClassificationWaits, listEventsByStatus, purgeHistory, queryProjectsPage, saveClassificationWaits, setReadState, setSettingRaw, updateUserState, upsertProjectDetails, upsertProjectsBatch } from '../src/storage/repositories.js'
import { defaultFilterDefinition, defaultSettings } from '../src/shared/types.js'
import { mergeSettings, notificationsAllowed, pickLatestProjectId } from '../src/main/policies.js'
import { DetailsFetcher, DETAILS_TTL_MS } from '../src/main/details.js'
import { DetailBudget } from '../src/collector/detailBudget.js'
import { EnrichmentQueue } from '../src/collector/enrichment.js'
import { parseProjectBody } from '../src/collector/projectBody.js'
import { dispatchPending } from '../src/main/notifier.js'
import { matchesDefinition } from '../src/shared/filters.js'

const databases: Db[] = []
afterEach(() => { for (const db of databases.splice(0)) if (db.isOpen) closeDatabase(db) })
function seed(path = ':memory:', n = 3): Db {
  const db = openDatabase(path); databases.push(db)
  upsertProjectsBatch(db, Array.from({ length: n }, (_, i) => ({ source: 'mostaql', externalId: String(i + 1), url: `https://mostaql.com/go/${i + 1}`, title: `Project ${i + 1}`, descriptionExcerpt: 'React work', publishedAt: null, publishedRaw: null })), { now: '2020-01-01T00:00:00.000Z', discoveryKind: 'initial' })
  return db
}
const body = readFileSync('tests/fixtures/detail-body.html', 'utf8')

describe('UI fixes: storage and policies', () => {
  it('migrates an actual v2 schema with settings/read/events/waits and preserves them after reopening', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rased-migration-')), 'v2.db')
    let db = seed(file)
    setReadState(db, 1, true)
    createPendingEvents(db, [2], 'new_project', '2020-01-01T00:00:00.000Z')
    saveClassificationWaits(db, new Map([[3, 2_000_000_000_000]]))
    setSettingRaw(db, 'app', JSON.stringify({ language: 'en', showUnreadOnly: true }))
    db.exec('DROP TABLE project_user_state; DROP TABLE project_details; DROP TABLE saved_filters; DROP TABLE tombstones; PRAGMA user_version=2;')
    closeDatabase(db)
    db = openDatabase(file); databases.push(db)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    expect(queryProjectsPage(db, defaultFilterDefinition(), { limit: 20, offset: 0 }).unread).toBe(2)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(1)
    expect(listClassificationWaits(db).get(3)).toBe(2_000_000_000_000)
    expect(JSON.parse(getSettingRaw(db, 'app')!)).toEqual({ language: 'en', showUnreadOnly: true })
    updateUserState(db, 1, { note: 'migrated', saved: true })
    closeDatabase(db); db = openDatabase(file); databases.push(db)
    expect(getUserState(db, 1).note).toBe('migrated')
  })
  it('links the actual display definition, keeps its scope/search/budget and unlinks without overwriting rules', () => {
    const s = defaultSettings()
    const def = { ...defaultFilterDefinition(), scope: 'hidden' as const, search: 'React', budgetMin: 50, categoryFilter: { ...s.displayFilter, mode: 'selected' as const, categories: ['design'] } }
    const unlinked = mergeSettings(s, { displayQuery: def })
    expect(unlinked.notifyFilter.mode).toBe('all')
    const linked = mergeSettings(unlinked, { linkDisplayAndNotifyFilters: true })
    expect(linked.notifyFilter).toEqual(def.categoryFilter)
    expect(linked.displayQuery).toEqual(def)
    const changed = mergeSettings(linked, { notifyFilter: { ...s.notifyFilter, keywordsAll: ['React'] } })
    expect(changed.displayQuery.categoryFilter).toEqual(changed.notifyFilter)
    expect(changed.displayQuery.search).toBe('React')
    const detached = mergeSettings(changed, { linkDisplayAndNotifyFilters: false })
    expect(detached.notifyFilter).toEqual(changed.notifyFilter)
    expect(detached.displayQuery).toEqual(changed.displayQuery)
  })
  it('uses one complete predicate for arrivals and stored search/scope/budget/status filters', () => {
    const db = seed(); updateUserState(db, 1, { hidden: true, status: 'submitted' })
    const d = { ...defaultFilterDefinition(), scope: 'hidden' as const, search: 'Project 1', statuses: ['submitted' as const], includeUnknownBudget: true }
    const page = queryProjectsPage(db, d, { limit: 20, offset: 0 })
    expect(page.rows.map(p => p.id)).toEqual([1])
    expect(matchesDefinition(page.rows[0]!, d)).toBe(true)
    expect(matchesDefinition(page.rows[0]!, { ...d, search: 'missing' })).toBe(false)
    expect(matchesDefinition(page.rows[0]!, { ...d, includeUnknownBudget: false })).toBe(false)
  })
  it('places known publication timestamps before nulls, with deterministic ties', () => {
    const db = seed()
    db.prepare('UPDATE projects SET published_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', 1)
    db.prepare('UPDATE projects SET published_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', 2)
    expect(queryProjectsPage(db, { ...defaultFilterDefinition(), sort: 'latestPublished' }, { limit: 10, offset: 0 }).rows.map(p => p.id)).toEqual([2, 1, 3])
  })
  it('rechecks DND after an awaited send, suppresses the rest and never floods after expiry', async () => {
    const db = seed(); createPendingEvents(db, [1, 2, 3], 'new_project', new Date().toISOString())
    const s = defaultSettings(); let calls = 0, beeps = 0
    await dispatchPending(db, { sessionId: 'audit', nowIso: new Date().toISOString(), recovering: false, batchKey: null }, {
      shouldSend: () => notificationsAllowed(s, 1000),
      sendSingle: async () => { calls++; await Promise.resolve(); s.doNotDisturbUntil = new Date(2000).toISOString(); return true },
      sendSummary: async () => { throw Error('unexpected summary') },
      onBeep: () => { if (notificationsAllowed(s, 1000)) beeps++ }
    })
    expect(calls).toBe(1); expect(beeps).toBe(0)
    expect(listEventsByStatus(db, 'suppressed')).toHaveLength(2)
    expect(notificationsAllowed(s, 2001)).toBe(true)
    await dispatchPending(db, { sessionId: 'audit', nowIso: new Date().toISOString(), recovering: false, batchKey: null }, { sendSingle: async () => { calls++; return true }, sendSummary: async () => true })
    expect(calls).toBe(1)
  })
  it('selects the newest batch project using persisted discovery time and id ties', () => {
    expect(pickLatestProjectId([{ id: 3, firstSeenAt: '2026-01-02' }, { id: 8, firstSeenAt: '2026-01-01' }, { id: 4, firstSeenAt: '2026-01-02' }])).toBe(4)
    expect(pickLatestProjectId([])).toBeNull()
  })
})

describe('UI fixes: HTML request lifecycle', () => {
  it('shares a single HTML slot and minimum gap across metadata and full descriptions', async () => {
    const db = seed(); const budget = new DetailBudget(); let now = 10000, calls = 0
    const pending: (() => void)[] = []
    const fetchImpl = (async () => { calls++; await new Promise<void>(r => pending.push(r)); return new Response(body) }) as typeof fetch
    const f = new DetailsFetcher(() => db, { budget, nowMs: () => now, fetchImpl })
    const q = new EnrichmentQueue({ budget, nowMs: () => now, fetchImpl })
    f.request(1, 'https://mostaql.com/go/1', false); const first = f.pump()
    f.request(2, 'https://mostaql.com/go/2', false); q.enqueue(3, 'https://mostaql.com/go/3')
    expect(await f.pump()).toBe(false); expect(await q.pump()).toBe(false); expect(calls).toBe(1)
    pending.shift()!(); await first
    expect(await q.pump()).toBe(false)
    now += 2000; const metadata = q.pump(); expect(calls).toBe(2)
    pending.shift()!(); await metadata
  })
  it('cancels a genuinely running request without reporting failure or backoff', async () => {
    const db = seed(); const failures: string[] = []
    const f = new DetailsFetcher(() => db, { fetchImpl: ((_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))))) as typeof fetch, onTransportFailure: k => failures.push(k) })
    f.request(1, 'https://mostaql.com/go/1', false); const running = f.pump()
    expect(getProjectDetailsRow(db, 1).status).toBe('loading')
    f.abortActive(); await running
    expect(getProjectDetailsRow(db, 1).status).toBe('not_requested'); expect(failures).toEqual([])
  })
  it('drops completion and queued work for a project deleted during fetch', async () => {
    const db = seed(); let release = () => {}
    const f = new DetailsFetcher(() => db, { fetchImpl: (async () => { await new Promise<void>(r => { release = r }); return new Response(body) }) as typeof fetch })
    f.request(1, 'https://mostaql.com/go/1', false); const running = f.pump()
    f.request(2, 'https://mostaql.com/go/2', false)
    purgeHistory(db, '2021-01-01T00:00:00.000Z', ['initial'])
    release(); await expect(running).resolves.toBe(true)
    await expect(f.pump()).resolves.toBe(false)
  })
  it('does not write or notify after a database has closed', async () => {
    const db = seed(); let release = () => {}; let settled = 0
    const f = new DetailsFetcher(() => db, { fetchImpl: (async () => { await new Promise<void>(r => { release = r }); return new Response(body) }) as typeof fetch, onSettled: () => settled++ })
    f.request(1, 'https://mostaql.com/go/1', false); const running = f.pump()
    closeDatabase(db); release(); await expect(running).resolves.toBe(true); expect(settled).toBe(0)
  })
  it('refreshes stale ready cache while serving old text, and labels truncated bodies honestly', async () => {
    const db = seed(); const old = '2020-01-01T00:00:00.000Z'
    upsertProjectDetails(db, 1, { text: 'old cache', provenance: 'full', fetchedAt: old, status: 'ready', errorCode: null })
    const long = '<div id="projectDetailsTab"><p>' + 'a'.repeat(21000) + '</p></div>'
    expect(parseProjectBody(long)).toMatchObject({ ok: true, truncated: true })
    const f = new DetailsFetcher(() => db, { nowMs: () => Date.parse(old) + DETAILS_TTL_MS + 1, fetchImpl: (async () => new Response(long)) as typeof fetch })
    expect(f.request(1, 'https://mostaql.com/go/1', false).text).toBe('old cache')
    await f.pump(); expect(getProjectDetailsRow(db, 1)).toMatchObject({ provenance: 'truncated', status: 'ready' })
  })
})
