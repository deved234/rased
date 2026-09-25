import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRss } from '../src/collector/rss.js'
import { fetchDetail } from '../src/collector/enrichment.js'
import { initialSchedulerState, noteFailure, noteSuccess, delayUntilNext } from '../src/collector/scheduler.js'
import { openDatabase } from '../src/storage/db.js'
import { applySuccessfulCycle } from '../src/collector/pipeline.js'
import { defaultSettings } from '../src/shared/types.js'
import { normalizeItems } from '../src/collector/normalize.js'
import { countProjects, createPendingEvents, listClassificationWaits, listEventsByStatus, listProjects, upsertProjectsBatch } from '../src/storage/repositories.js'
import { dispatchPending } from '../src/main/notifier.js'

afterEach(() => vi.useRealTimers())

describe('review regressions', () => {
  it('keeps the RSS timeout active while reading the body', async () => {
    vi.useFakeTimers()
    const request = fetchRss('https://mostaql.com/rss', {
      timeoutMs: 10,
      fetchImpl: (async (_url, init) => new Promise<Response>((resolve) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init!.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
          }
        })
        resolve(new Response(stream, { headers: { 'content-type': 'text/xml' } }))
      })) as typeof fetch
    })
    await vi.advanceTimersByTimeAsync(20)
    expect((await request)).toMatchObject({ ok: false, kind: 'timeout' })
  })

  it('classifies an RSS body socket error', async () => {
    const fetchImpl = (async () => new Response(new ReadableStream({ start(c) { c.error(new Error('body socket reset')) } }))) as typeof fetch
    expect(await fetchRss('https://mostaql.com/rss', { fetchImpl })).toMatchObject({ ok: false, kind: 'network' })
  })

  it('honors configured cadence, post-request rest, and existing host cooldown', () => {
    const s = initialSchedulerState()
    expect(delayUntilNext(s, 5000, 250, 0)).toBe(4750)
    expect(delayUntilNext(s, 2000, 250, 0)).toBe(1750)
    expect(delayUntilNext(s, 5000, 11000, 0, 11000)).toBe(1000)
    const failed = noteFailure(s, { kind: 'rate_limited', retryAfterMs: 60_000, nowMs: 0, random: () => 0.5 })
    expect(noteSuccess(failed, 1000).backoffUntilMs).toBe(60_000)
  })

  it('persists an uncertain-category wait without sending before the deadline', () => {
    const db = openDatabase(':memory:')
    try {
      const settings = defaultSettings()
      settings.notifyFilter = { ...settings.notifyFilter, mode: 'selected', categories: ['design'] }
      settings.notifyUncertainCategory = true
      const nowMs = Date.parse('2026-09-25T10:00:00Z')
      const ctx = { nowIso: new Date(nowMs).toISOString(), nowMs, runId: 'test', settings, durationMs: 10, itemCount: 1, invalidSingles: 0, firstCycleOfRun: false }
      const items = (ids: string[]) => normalizeItems(ids.map(id => ({ title: 'Project', link: `https://mostaql.com/go/${id}`, description: 'Test', pubDateRaw: null }))).valid
      applySuccessfulCycle(db, items(['1']), { ...ctx, firstCycleOfRun: true })
      const result = applySuccessfulCycle(db, items(['1', '2']), ctx)
      expect(result.uncertainWaits.size).toBe(1)
      expect(listClassificationWaits(db).size).toBe(1)
      expect(listEventsByStatus(db, 'pending')).toHaveLength(0)
    } finally { db.close() }
  })

  it('filters list rows before pagination and count, including keywords', () => {
    const db = openDatabase(':memory:')
    try {
      upsertProjectsBatch(db, ['Design logo', 'Write article', 'Design banner'].map((title, i) => ({ source: 'mostaql', externalId: String(i), title, descriptionExcerpt: '', url: `https://mostaql.com/go/${i}`, publishedAt: null, publishedRaw: null })), { now: '2026-09-25T10:00:00Z', discoveryKind: 'live' })
      const displayFilter = { ...defaultSettings().displayFilter, keywordsAny: ['design'], excludeKeywords: ['logo'] }
      expect(countProjects(db, { displayFilter }).total).toBe(1)
      expect(listProjects(db, { displayFilter, limit: 1, offset: 0 }).map(p => p.title)).toEqual(['Design banner'])
    } finally { db.close() }
  })

  it('suppresses pending events when current settings no longer allow them', async () => {
    const db = openDatabase(':memory:')
    try {
      const nowIso = '2026-09-25T10:00:00Z'
      const r = upsertProjectsBatch(db, [{ source: 'mostaql', externalId: '1', title: 'Test', descriptionExcerpt: '', url: 'https://mostaql.com/go/1', publishedAt: null, publishedRaw: null }], { now: nowIso, discoveryKind: 'live' })
      createPendingEvents(db, r.insertedIds, 'new_project', nowIso)
      let sent = 0
      await dispatchPending(db, { sessionId: 's', nowIso, recovering: false, batchKey: null }, { shouldSend: () => false, sendSingle: async () => { sent++; return true }, sendSummary: async () => true })
      expect(sent).toBe(0)
      expect(listEventsByStatus(db, 'suppressed')).toHaveLength(1)
    } finally { db.close() }
  })

  it('parses HTTP-date Retry-After on detail responses', async () => {
    const date = new Date(Date.now() + 600_000).toUTCString()
    const result = await fetchDetail('https://mostaql.com/go/1', { fetchImpl: (async () => new Response('', { status: 429, headers: { 'retry-after': date } })) as typeof fetch })
    expect(result.status).toBe(429)
    expect(result.retryAfterMs).toBeGreaterThan(590_000)
  })
})
