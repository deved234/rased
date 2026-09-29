import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchNafezlyFeed, matchesNafezlyKeywords, parseNafezlyFeed } from '../src/collector/nafezly.js'
import { applyNafezlyCycle } from '../src/collector/nafezlyPipeline.js'
import { closeDatabase, openDatabase } from '../src/storage/db.js'
import { getProjectById, getProjectDetailsRow, getSourceState, listEventsByStatus } from '../src/storage/repositories.js'
import { isAllowedProjectUrl } from '../src/main/links.js'
import { defaultSettings } from '../src/shared/types.js'

const item = (id: number, title: string, description: string, date: string): string => `<item><title>${title}</title><link>https://nafezly.com/project/${id}-sample</link><description>${description}</description><pubDate>${date}</pubDate></item>`
const feed = (...rows: string[]): string => `\n<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Nafezly.com | نفذلي</title>${rows.join('')}</channel></rss>`

describe('Nafezly RSS', () => {
  it('parses the public feed shape including its leading newline and full descriptions', () => {
    const projects = parseNafezlyFeed(feed(item(100, 'مشروع جديد', 'وصف طويل React ومفصل', 'Tue, 29 Sep 2026 10:00:00 GMT')))
    expect(projects).toHaveLength(1)
    expect(projects[0]?.externalId).toBe('100')
    expect(projects[0]?.fullDescription).toContain('React')
    expect(projects[0]?.publishedAt).toBe('2026-09-29T10:00:00.000Z')
    expect(matchesNafezlyKeywords(projects[0]!.title, projects[0]!.fullDescription, ['react'], [])).toBe(true)
    expect(isAllowedProjectUrl(projects[0]!.url)).toBe(true)
    expect(isAllowedProjectUrl('https://nafezly.com.evil.example/project/100-sample')).toBe(false)
  })

  it('rejects a challenge page and backs off on rate limits', async () => {
    expect(() => parseNafezlyFeed('<html>challenge</html>')).toThrow()
    expect(() => parseNafezlyFeed(feed(item(100, 'safe', 'text', 'Tue, 29 Sep 2026 10:00:00 GMT').replace('nafezly.com', 'evil.example')))).toThrow()
    const result = await fetchNafezlyFeed(undefined, async () => new Response('', { status: 429, headers: { 'retry-after': '60' } }))
    expect(result.ok).toBe(false)
    expect(result.retryAfterMs).toBe(60_000)
  })

  it('keeps the baseline silent, stores the full description, and alerts only fresh matching projects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rased-nafezly-'))
    const db = openDatabase(join(dir, 'test.db'))
    try {
      const settings = defaultSettings()
      settings.nafezlyKeywordsAny = ['React']
      const baseline = applyNafezlyCycle(db, parseNafezlyFeed(feed(item(100, 'قديم', 'وصف', 'Tue, 29 Sep 2026 09:59:00 GMT'))), { nowMs: Date.parse('2026-09-29T10:00:00Z'), runId: 'a', durationMs: 200, settings })
      expect(baseline.notifyIds).toHaveLength(0)
      expect(getSourceState(db, 'nafezly').baselineComplete).toBe(true)
      const next = applyNafezlyCycle(db, parseNafezlyFeed(feed(item(101, 'مشروع', 'مطلوب React وخبرة', 'Tue, 29 Sep 2026 10:00:06 GMT'), item(103, 'React قديم', 'وصف', 'Mon, 28 Sep 2026 10:00:00 GMT'), item(100, 'قديم', 'وصف', 'Tue, 29 Sep 2026 09:59:00 GMT'))), { nowMs: Date.parse('2026-09-29T10:00:10Z'), runId: 'a', durationMs: 200, settings })
      expect(next.insertedIds).toHaveLength(2)
      expect(next.notifyIds).toHaveLength(1)
      expect(getProjectById(db, next.notifyIds[0]!)?.externalId).toBe('101')
      expect(getProjectDetailsRow(db, next.notifyIds[0]!)?.text).toContain('React')
      expect(listEventsByStatus(db, 'pending')).toHaveLength(1)
      const repeat = applyNafezlyCycle(db, parseNafezlyFeed(feed(item(101, 'مشروع', 'مطلوب React وخبرة', 'Tue, 29 Sep 2026 10:00:06 GMT'), item(100, 'قديم', 'وصف', 'Tue, 29 Sep 2026 09:59:00 GMT'))), { nowMs: Date.parse('2026-09-29T10:00:20Z'), runId: 'a', durationMs: 200, settings })
      expect(repeat.notifyIds).toHaveLength(0)
    } finally {
      closeDatabase(db)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
