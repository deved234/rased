import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasDangerousDoctype, parseRetryAfterMs, parseRssItems } from '../src/collector/rss.js'

const sample = readFileSync(join(__dirname, 'fixtures', 'rss-sample.xml'), 'utf-8')

describe('parseRssItems', () => {
  it('extracts title/link/description/pubDate from a real-shaped feed', () => {
    const { items, invalidSingles } = parseRssItems(sample)
    expect(invalidSingles).toBe(0)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      title: 'تطوير لوحة تحكم لمتجر إلكتروني',
      link: 'https://mostaql.com/go/1280144',
      pubDateRaw: 'Thu, 24 Sep 2026 13:29:11 +0000'
    })
    expect(items[0]?.description).toContain('React')
  })

  it('decodes entities and tolerates missing optional fields', () => {
    const { items } = parseRssItems(sample)
    expect(items[1]?.title).toBe('تصميم هوية بصرية & شعار')
    expect(items[1]?.description).toContain('<قوي>')
    expect(items[2]?.description).toBe('')
    expect(items[2]?.pubDateRaw).toBeNull()
  })

  it('isolates a single bad item without dropping the batch', () => {
    const xml = sample.replace('<link>https://mostaql.com/go/100</link>', '<link>not a url</link>')
    const { items, invalidSingles } = parseRssItems(xml)
    expect(items).toHaveLength(3) // link present -> parse ok; normalize rejects later
    expect(invalidSingles).toBe(0)
    const xml2 = sample.replace('<title>مشروع بلا وصف ولا تاريخ</title>', '<title></title>')
    const r2 = parseRssItems(xml2)
    expect(r2.items).toHaveLength(2)
    expect(r2.invalidSingles).toBe(1)
  })

  it('fails loudly on malformed XML instead of returning an empty list', () => {
    expect(() => parseRssItems('<rss><channel><item>')).toThrow()
    expect(() => parseRssItems('{"not":"xml"}')).toThrow()
  })
})

describe('hasDangerousDoctype', () => {
  it('rejects entity/system doctypes, allows plain feeds', () => {
    expect(hasDangerousDoctype(sample)).toBe(false)
    expect(hasDangerousDoctype('<?xml?><!DOCTYPE rss [<!ENTITY x "y">]><rss/>')).toBe(true)
    expect(hasDangerousDoctype('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0">')).toBe(true)
  })
})

describe('parseRetryAfterMs', () => {
  it('handles seconds, HTTP dates and garbage', () => {
    expect(parseRetryAfterMs('120', 0)).toBe(120_000)
    expect(parseRetryAfterMs('0', 0)).toBe(0)
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:00 GMT'))).toBe(60_000)
    expect(parseRetryAfterMs(null, 0)).toBeNull()
    expect(parseRetryAfterMs('soon', 0)).toBeNull()
    expect(parseRetryAfterMs('-5', 0)).toBeNull()
  })
})
