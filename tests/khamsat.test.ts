import { describe, expect, it } from 'vitest'
import { fetchKhamsatRequests, isFreshKhamsatRequest, matchesKhamsatKeywords, parseKhamsatRequests } from '../src/collector/khamsat.js'
import { isAllowedProjectUrl } from '../src/main/links.js'
import { applyKhamsatCycle } from '../src/collector/khamsatPipeline.js'
import { closeDatabase, openDatabase } from '../src/storage/db.js'
import { addTombstones, getProjectById, getSourceState, listEventsByStatus } from '../src/storage/repositories.js'
import { defaultSettings } from '../src/shared/types.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const row = (id: number, title: string, published: string, interaction: string): string => `<tr id="forum_post-${id}" class="forum_post"><td class="details-td"><h3 class="details-head"><a class="ajaxbtn" href="/community/requests/${id}-${title}">${title}</a></h3><span dir="ltr" title="${published}">منذ دقيقة</span><span title="${interaction}">آخر تفاعل</span></td></tr>`
const html = `<table id="forums_table"><tbody>${row(797930, 'طلب قديم', '28&#x2F;09&#x2F;2026 07:57:41 GMT', '28&#x2F;09&#x2F;2026 09:27:37 GMT')}${row(797934, 'مطلوب React &amp; TypeScript', '28&#x2F;09&#x2F;2026 09:08:28 GMT', '28&#x2F;09&#x2F;2026 09:08:28 GMT')}</tbody></table>`

describe('Khamsat public listing', () => {
  it('reads all rows and publication time, not activity order', () => {
    const items = parseKhamsatRequests(html)
    expect(items.map(item => item.externalId)).toEqual(['797930', '797934'])
    expect(items[1]?.title).toBe('مطلوب React & TypeScript')
    expect(items[1]?.publishedAt).toBe('2026-09-28T09:08:28.000Z')
    expect(items[1]?.url).toBe(new URL('/community/requests/797934-مطلوب React & TypeScript', 'https://khamsat.com').href)
  })

  it('does not alert when an old discussion returns to the first page', () => {
    const now = Date.parse('2026-09-28T09:30:00Z')
    expect(isFreshKhamsatRequest('2026-09-28T00:18:24Z', '2026-09-28T09:29:55Z', now)).toBe(false)
    expect(isFreshKhamsatRequest('2026-09-28T09:29:58Z', '2026-09-28T09:29:55Z', now)).toBe(true)
    expect(isFreshKhamsatRequest('2026-09-28T09:29:58Z', null, now)).toBe(false)
  })

  it('rejects empty or altered list markup instead of treating it as no requests', () => {
    expect(() => parseKhamsatRequests('<html>challenge</html>')).toThrow()
    expect(() => parseKhamsatRequests('<table id="forums_table"></table>')).toThrow()
  })

  it('filters by title and only allows exact Khamsat request links', () => {
    expect(matchesKhamsatKeywords('مطلوب تصميم موقع React', ['react'], ['ترجمة'])).toBe(true)
    expect(matchesKhamsatKeywords('مطلوب تصميم موقع React', ['react'], ['تصميم'])).toBe(false)
    expect(isAllowedProjectUrl('https://khamsat.com/community/requests/797934-%D9%85%D8%B7%D9%84%D9%88%D8%A8')).toBe(true)
    expect(isAllowedProjectUrl('https://evil.example/community/requests/797934')).toBe(false)
    expect(isAllowedProjectUrl('https://khamsat.com.evil.example/community/requests/797934')).toBe(false)
  })

  it('backs off on a non-HTML response without returning a valid list', async () => {
    const result = await fetchKhamsatRequests(undefined, async () => new Response('', { status: 202, headers: { 'content-type': 'text/html' } }))
    expect(result.ok).toBe(false)
    expect(result.status).toBe(202)
  })

  it('stores a silent baseline, alerts for a fresh title match, and suppresses an old resurfaced request', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rased-khamsat-'))
    const db = openDatabase(join(dir, 'test.db'))
    try {
      const settings = defaultSettings()
      settings.khamsatKeywordsAny = ['React']
      const baseline = parseKhamsatRequests(`<table id="forums_table"><tbody>${row(100, 'طلب قديم', '28&#x2F;09&#x2F;2026 08:59:00 GMT', '28&#x2F;09&#x2F;2026 08:59:00 GMT')}</tbody></table>`)
      const first = applyKhamsatCycle(db, baseline, { nowMs: Date.parse('2026-09-28T09:00:00Z'), runId: 'one', durationMs: 400, settings })
      expect(first.notifyIds).toHaveLength(0)
      expect(getSourceState(db, 'khamsat').baselineComplete).toBe(true)
      const next = parseKhamsatRequests(`<table id="forums_table"><tbody>${row(100, 'طلب قديم', '28&#x2F;09&#x2F;2026 08:59:00 GMT', '28&#x2F;09&#x2F;2026 09:00:05 GMT')}${row(102, 'مطلوب React', '28&#x2F;09&#x2F;2026 09:00:04 GMT', '28&#x2F;09&#x2F;2026 09:00:04 GMT')}${row(101, 'React قديم', '28&#x2F;09&#x2F;2026 00:18:24 GMT', '28&#x2F;09&#x2F;2026 09:00:05 GMT')}</tbody></table>`)
      const second = applyKhamsatCycle(db, next, { nowMs: Date.parse('2026-09-28T09:00:05Z'), runId: 'one', durationMs: 450, settings })
      expect(second.insertedIds).toHaveLength(2)
      expect(second.notifyIds).toHaveLength(1)
      expect(getProjectById(db, second.notifyIds[0]!)?.externalId).toBe('102')
      const old = second.insertedIds.map(id => getProjectById(db, id)).find(p => p?.externalId === '101')
      expect(old?.discoveryKind).toBe('recovered')
      expect(listEventsByStatus(db, 'pending')).toHaveLength(1)
      addTombstones(db, 'khamsat', ['103'])
      const deleted = parseKhamsatRequests(`<table id="forums_table"><tbody>${row(103, 'مطلوب React جديد', '28&#x2F;09&#x2F;2026 09:00:06 GMT', '28&#x2F;09&#x2F;2026 09:00:06 GMT')}</tbody></table>`)
      const third = applyKhamsatCycle(db, deleted, { nowMs: Date.parse('2026-09-28T09:00:07Z'), runId: 'one', durationMs: 400, settings })
      expect(third.insertedIds).toHaveLength(0)
      expect(third.notifyIds).toHaveLength(0)
    } finally {
      closeDatabase(db)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
