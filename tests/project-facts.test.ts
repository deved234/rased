import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseProjectFacts, parseFactBudget, parseFactDuration } from '../src/collector/projectFacts.js'
import { fetchDetail } from '../src/collector/enrichment.js'
import { openDatabase, type Db } from '../src/storage/db.js'
import { factsNeedFetch, markFacts, projectFacts, saveFetchedFacts } from '../src/storage/projectFacts.js'
import { getProjectById, upsertProjectsBatch, upsertProjectDetails, getProjectDetailsRow } from '../src/storage/repositories.js'
import { ProjectFactsFetcher } from '../src/main/projectFactsFetcher.js'
import { DetailsFetcher } from '../src/main/details.js'

const mostaql = readFileSync('tests/fixtures/mostaql-facts.html', 'utf8')
const nafezly = readFileSync('tests/fixtures/nafezly-facts.html', 'utf8')
const body = readFileSync('tests/fixtures/detail-body.html', 'utf8')
let db: Db | undefined, folder: string | undefined
function database(source = 'nafezly'): Db {
  folder = mkdtempSync(join(tmpdir(), 'rased-facts-unit-')); db = openDatabase(join(folder, 'rased.db'))
  upsertProjectsBatch(db, [{ source, externalId: '123', url: source === 'mostaql' ? 'https://mostaql.com/go/123' : 'https://nafezly.com/project/123-sample', title: 'Synthetic', descriptionExcerpt: 'RSS excerpt', publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'initial' })
  return db
}
afterEach(() => { if (db?.isOpen) db.close(); if (folder) rmSync(folder, { recursive: true, force: true }); db = undefined; folder = undefined })
const response = (html: string): Response => new Response(html, { headers: { 'content-type': 'text/html' } })

describe('Authoritative project-card fields', () => {
  it('reads Mostaql budget and duration while ignoring competing values outside the card', () => {
    expect(parseProjectFacts(mostaql, 'mostaql')).toMatchObject({ budgetMin: 25, budgetMax: 50, durationDays: 5, currency: 'USD' })
  })
  it('reads Nafezly public card fields, not JSON-LD hourly salary or descriptions', () => {
    expect(parseProjectFacts(nafezly, 'nafezly')).toMatchObject({ budgetMin: 10, budgetMax: 25, durationDays: 1 })
    expect(parseProjectFacts('<script>{"baseSalary":9000}</script><p>الميزانية 9999 دولار</p>', 'nafezly')).toBeNull()
    const empty = nafezly.replace('<div class="col-6 col-md-5 font-1">10 - 25 $</div>', '<div class="col-6 col-md-5 font-1">—</div>')
    expect(parseProjectFacts(empty, 'nafezly')?.budgetMin).toBeNull()
  })
  it('handles Arabic digits, entities, decimal amounts and week units', () => {
    expect(parseFactBudget('$١٬٠٠٠٫٥٠ – $٢٬٠٠٠')).toEqual({ budgetMin: 1000.5, budgetMax: 2000, currency: 'USD' })
    expect(parseFactBudget('50 USD')).toEqual({ budgetMin: 50, budgetMax: 50, currency: 'USD' })
    expect(parseFactDuration('٢ أسابيع')).toBe(14)
    expect(parseFactDuration('۷ يوماً')).toBe(7)
    expect(parseProjectFacts(mostaql.replace('5 أيام', '&#x665; أيام'), 'mostaql')?.durationDays).toBe(5)
  })
  it('does not invent currency, reverse ranges, free-text durations or missing labels', () => {
    expect(parseFactBudget('100 - 200 ريال').budgetMin).toBeNull()
    expect(parseFactBudget('$50 - $25').budgetMin).toBeNull()
    expect(parseFactDuration('خلال 10 أيام وربما أكثر')).toBeNull()
    expect(parseFactDuration('0 يوم')).toBeNull()
    expect(parseProjectFacts('<p>ميزانية 500 دولار و5 أيام</p>', 'mostaql')).toBeNull()
  })
  it('rejects mismatched hosts and cross-origin redirected detail responses', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; const res = response(nafezly); Object.defineProperty(res, 'url', { value: 'https://example.com/login' }); return res }) as typeof fetch
    expect((await fetchDetail('https://example.com/project/123', { source: 'nafezly', fetchImpl })).ok).toBe(false)
    expect(calls).toBe(0)
    expect((await fetchDetail('https://nafezly.com/project/123-sample', { source: 'nafezly', fetchImpl })).kind).toBe('invalid_content')
  })
})

describe('Facts cache and fetching', () => {
  it('refreshes old full-description caches without losing RSS text', async () => {
    const db = database(); let requests = 0
    upsertProjectDetails(db, 1, { text: 'Existing full RSS description', provenance: 'full', fetchedAt: new Date().toISOString(), status: 'ready', errorCode: null })
    const f = new ProjectFactsFetcher({ db: () => db, gateOpen: () => true, settled: () => {}, failure: () => {}, fetchImpl: (async () => { requests++; return response(nafezly) }) as typeof fetch })
    f.request(1); f.request(1); await f.pump()
    expect(requests).toBe(1)
    expect(getProjectDetailsRow(db, 1).text).toBe('Existing full RSS description')
    expect(getProjectById(db, 1)).toMatchObject({ budgetMin: 10, budgetMax: 25, durationDays: 1 })
    expect(projectFacts(db, 1)?.status).toBe('ready')
    f.request(1); await f.pump(); expect(requests).toBe(1)
    await f.close()
  })
  it('populates Mostaql metadata even when its description cache is already fresh', async () => {
    const db = database('mostaql')
    upsertProjectDetails(db, 1, { text: 'Old full body', provenance: 'full', fetchedAt: new Date().toISOString(), status: 'ready', errorCode: null })
    expect(factsNeedFetch(db, 1)).toBe(true)
    const f = new DetailsFetcher(() => db, { fetchImpl: (async () => response(body + mostaql)) as typeof fetch })
    f.request(1, 'https://mostaql.com/go/123', true); await f.pump()
    expect(projectFacts(db, 1)).toMatchObject({ budgetMin: 25, durationDays: 5, status: 'ready' })
  })
  it('uses a 24h success cache and a short automatic failure retry delay', () => {
    const db = database(), now = Date.parse('2026-10-15T00:00:00Z')
    saveFetchedFacts(db, 1, parseProjectFacts(nafezly, 'nafezly')!, new Date(now).toISOString())
    expect(factsNeedFetch(db, 1, now + 1000)).toBe(false)
    expect(factsNeedFetch(db, 1, now + 86400000)).toBe(true)
    markFacts(db, 1, 'failed', 'http-429', new Date(now).toISOString())
    expect(factsNeedFetch(db, 1, now + 1000)).toBe(false)
    expect(factsNeedFetch(db, 1, now + 60000)).toBe(true)
    expect(projectFacts(db, 1)?.budgetMin).toBe(10)
  })
  it('cancels active work without changing stored values or triggering source backoff', async () => {
    const db = database(); let calls = 0, failures = 0
    const f = new ProjectFactsFetcher({ db: () => db, gateOpen: () => true, settled: () => {}, failure: () => { failures++ }, fetchImpl: ((_url, options) => new Promise((_resolve, reject) => { calls++; options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })) as typeof fetch })
    f.request(1); const work = f.pump(); await Promise.resolve(); f.abortActive(); await work
    expect(calls).toBe(1); expect(failures).toBe(0)
    expect(projectFacts(db, 1)?.status).toBe('not_requested')
    expect(projectFacts(db, 1)?.budgetMin).toBeNull()
    await f.close()
  })
  it('honors the source gate and reports a rate limit without overwriting cached facts', async () => {
    const db = database(); let open = false, failures = 0, requests = 0
    saveFetchedFacts(db, 1, parseProjectFacts(nafezly, 'nafezly')!)
    const f = new ProjectFactsFetcher({ db: () => db, gateOpen: () => open, settled: () => {}, failure: result => { if (result.status === 429) failures++ }, fetchImpl: (async () => { requests++; return new Response('rate limited', { status: 429, headers: { 'retry-after': '300' } }) }) as typeof fetch })
    f.request(1, true); await f.pump(); expect(requests).toBe(0)
    open = true; await f.pump(); expect(requests).toBe(1); expect(failures).toBe(1)
    expect(projectFacts(db, 1)).toMatchObject({ budgetMin: 10, durationDays: 1, status: 'failed', errorCode: 'http-429' })
    await f.close()
  })
})
