import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDetail } from '../src/collector/enrichment.js'

const html = readFileSync(join(__dirname, 'fixtures', 'detail-sample.html'), 'utf-8')

describe('parseDetail', () => {
  it('extracts the real category, skills and budget from page anchors', () => {
    const d = parseDetail(html)
    expect(d.categorySlug).toBe('support')
    expect(d.categoryConfirmed).toBe(true)
    expect(d.categoryName).toContain('دعم')
    expect(d.skills).toEqual(['إدارة المشاريع', 'ووردبريس'])
    expect(d.budgetMin).toBe(25)
    expect(d.budgetMax).toBe(50)
    expect(d.currency).toBe('USD')
  })

  it('falls back to the JSON-LD occupational name when the breadcrumb is absent', () => {
    const noCrumb = html.replace(/data-index="2"[^>]*>\s*<a[^>]*href="[^"]*"[^>]*>.*?<\/a>/s, 'data-index="2">')
    const d = parseDetail(noCrumb)
    expect(d.categorySlug).toBe('support')
    expect(d.categoryConfirmed).toBe(true)
  })

  it('returns empty data instead of guessing when the page is useless', () => {
    const d = parseDetail('<html><body>challenge</body></html>')
    expect(d.categorySlug).toBeNull()
    expect(d.categoryConfirmed).toBe(false)
    expect(d.skills).toEqual([])
    expect(d.budgetMin).toBeNull()
  })
})
