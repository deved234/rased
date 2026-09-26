import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extractDivById, parseProjectBody } from '../src/collector/projectBody.js'
import { DetailsFetcher, resetStaleLoadingDetails } from '../src/main/details.js'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import { getProjectDetailsRow, upsertProjectsBatch } from '../src/storage/repositories.js'

const body = readFileSync(join(__dirname, 'fixtures', 'detail-body.html'), 'utf-8')
const changed = readFileSync(join(__dirname, 'fixtures', 'detail-body-changed.html'), 'utf-8')

describe('parseProjectBody', () => {
  it('extracts only tab paragraphs as plain text', () => {
    const r = parseProjectBody(body)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paragraphs).toBe(3)
    expect(r.text).toContain('مراجعة الموقع')
    expect(r.text).toContain('مقابلات تقنية')
    expect(r.text).not.toContain('روابط تذييل')
    expect(r.text).not.toContain('<')
    expect(r.text).not.toContain('var x')
  })

  it('fails honestly on changed markup, empty tab and garbage', () => {
    expect(parseProjectBody(changed)).toEqual({ ok: false, error: 'no-description' })
    expect(parseProjectBody('<html><body>challenge</body></html>')).toEqual({ ok: false, error: 'no-description' })
    const emptyTab = body.replace(/<p>.*?<\/p>/gs, '') + `<!-- ${'filler '.repeat(120)} -->`
    expect(parseProjectBody(emptyTab)).toEqual({ ok: false, error: 'empty' })
  })

  it('caps very long bodies instead of storing everything', () => {
    const long = body.replace('</p>', ' word'.repeat(9000) + '</p>')
    const r = parseProjectBody(long)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text.length).toBeLessThanOrEqual(20_000)
  })

  it('extractDivById balances nested divs', () => {
    expect(extractDivById(body, 'missing')).toBeNull()
    const tab = extractDivById(body, 'projectDetailsTab')
    expect(tab).toContain('text-wrapper-div')
    expect(tab).not.toContain('footer')
  })
})

describe('DetailsFetcher', () => {
  let dir = ''
  let db: Db
  const URL = 'https://mostaql.com/go/1'

  const htmlFetch = (htmlBody: string, status = 200) => () =>
    Promise.resolve(new Response(htmlBody, { status, headers: { 'content-type': 'text/html' } }) as unknown as Response)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rased-det-'))
    db = openDatabase(join(dir, 't.db'))
    upsertProjectsBatch(
      db,
      [{ source: 'mostaql', externalId: '1', url: URL, title: 't', descriptionExcerpt: 'd', publishedAt: null, publishedRaw: null }],
      { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' }
    )
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves cache, dedupes inflight and stores ready with provenance', async () => {
    let calls = 0
    const settled: number[] = []
    let clock = Date.now()
    const f = new DetailsFetcher(() => db, {
      fetchImpl: (async () => {
        calls++
        return htmlFetch(body)()
      }) as unknown as typeof fetch,
      gateOpen: () => true,
      nowMs: () => clock,
      onSettled: (id) => settled.push(id)
    })
    const first = f.request(1, URL, false)
    expect(first.status).toBe('loading') // queued honestly, no fake text
    expect(first.text).toBeNull()
    expect(f.request(1, URL, false).status).toBe('loading') // deduped
    expect(await f.pump()).toBe(true)
    expect(await f.pump()).toBe(false)
    expect(calls).toBe(1)
    const row = getProjectDetailsRow(db, 1)
    expect(row.status).toBe('ready')
    expect(row.provenance).toBe('full')
    expect(row.text).toContain('مراجعة الموقع')
    expect(settled).toEqual([1])
    // cache hit: no refetch
    expect(f.request(1, URL, false).status).toBe('ready')
    expect(calls).toBe(1)
    // force refetches
    f.request(1, URL, true)
    clock += 2000
    expect(await f.pump()).toBe(true)
    expect(calls).toBe(2)
  })

  it('records failed with error code and keeps serving the excerpt path', async () => {
    const f = new DetailsFetcher(() => db, { fetchImpl: htmlFetch('short', 404) as unknown as typeof fetch, gateOpen: () => true })
    f.request(1, URL, false)
    expect(await f.pump()).toBe(true)
    const row = getProjectDetailsRow(db, 1)
    expect(row.status).toBe('failed')
    expect(row.errorCode).toBe('http-404')
    expect(row.text).toBeNull() // nothing invented
  })

  it('drops a queued request without fetching or reporting transport failure', async () => {
    const failures: string[] = []
    const f = new DetailsFetcher(() => db, {
      fetchImpl: htmlFetch(body) as unknown as typeof fetch,
      gateOpen: () => true,
      onTransportFailure: (k) => failures.push(k)
    })
    f.request(1, URL, false)
    f.abortActive()
    // No request has started yet: abortActive alone does not remove queued jobs.
    f.drop(1)
    expect(await f.pump()).toBe(false)
    expect(f.pending).toBe(0)
    expect(getProjectDetailsRow(db, 1).status).toBe('not_requested')
    expect(failures).toEqual([])
  })

  it('resets crash-stuck loading rows to retryable on boot', () => {
    db.prepare("INSERT INTO project_details (project_id, description_text, provenance, fetched_at, status, error_code) VALUES (1, 'old', 'full', '2026-09-24T14:00:00.000Z', 'loading', NULL);").run()
    expect(resetStaleLoadingDetails(db)).toBe(1)
    const row = getProjectDetailsRow(db, 1)
    expect(row.status).toBe('not_requested')
    expect(row.text).toBe('old') // cached text preserved
  })
})
