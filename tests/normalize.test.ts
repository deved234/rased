import { describe, expect, it } from 'vitest'
import { canonicalUrl, cleanExcerpt, extractExternalId, normalizeItems, parsePubDate } from '../src/collector/normalize.js'
import type { RawRssItem } from '../src/collector/rss.js'

describe('extractExternalId / canonicalUrl', () => {
  it('accepts exact mostaql https go-links', () => {
    expect(extractExternalId('https://mostaql.com/go/1280144')).toBe('1280144')
    expect(canonicalUrl('https://mostaql.com/go/1280144')).toBe('https://mostaql.com/go/1280144')
  })
  it('rejects wrong host, protocol, javascript:, file: and non-numeric ids', () => {
    expect(canonicalUrl('http://mostaql.com/go/1')).toBeNull()
    expect(canonicalUrl('https://evilmostaql.com/go/1')).toBeNull()
    expect(canonicalUrl('https://mostaql.com.evil.com/go/1')).toBeNull()
    expect(canonicalUrl('javascript:alert(1)')).toBeNull()
    expect(canonicalUrl('https://mostaql.com/projects')).toBeNull()
    expect(canonicalUrl('https://mostaql.com/go/abc')).toBeNull()
    expect(canonicalUrl('not a url')).toBeNull()
  })
})

describe('parsePubDate', () => {
  it('normalizes to UTC iso, keeps raw, tolerates garbage', () => {
    const good = parsePubDate('Thu, 24 Sep 2026 13:29:11 +0000')
    expect(good.iso).toBe('2026-09-24T13:29:11.000Z')
    expect(parsePubDate(null).iso).toBeNull()
    expect(parsePubDate('yesterday-ish').iso).toBeNull()
  })
})

describe('cleanExcerpt', () => {
  it('strips tags and decodes entities to plain text', () => {
    expect(cleanExcerpt('<p>hello <b>world</b></p>')).toBe('hello world')
    expect(cleanExcerpt('a &amp; b &nbsp; c')).toBe('a & b c')
  })
})

describe('normalizeItems', () => {
  const raw: RawRssItem[] = [
    { title: 'A', link: 'https://mostaql.com/go/5', description: 'd', pubDateRaw: null },
    { title: 'B', link: 'https://evil.com/go/6', description: 'd', pubDateRaw: null },
    { title: '   ', link: 'https://mostaql.com/go/7', description: 'd', pubDateRaw: null }
  ]
  it('keeps valid, isolates invalid singles', () => {
    const { valid, invalidSingles } = normalizeItems(raw)
    expect(valid.map((v) => v.externalId)).toEqual(['5'])
    expect(invalidSingles).toBe(2)
  })
})
