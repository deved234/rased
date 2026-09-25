// Normalization: IDs, URLs, timestamps, excerpts.
// Rule: dedupe by (source, externalId) membership — IDs are NOT in time order.

import type { UpsertInput } from '../storage/repositories.js'
import type { RawRssItem } from './rss.js'

export const SOURCE = 'mostaql'
const GO_RE = /^https:\/\/mostaql\.com\/go\/(\d+)\/?(?:[?#].*)?$/

export interface NormalizedItem extends UpsertInput {
  invalid: false
}

export function extractExternalId(link: string): string | null {
  const m = GO_RE.exec(link.trim())
  return m && m[1] ? m[1] : null
}

/** Only exact mostaql.com HTTPS project links are trusted. */
export function canonicalUrl(link: string): string | null {
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.hostname.toLowerCase() !== 'mostaql.com') return null
  const id = extractExternalId(u.toString())
  if (!id) return null
  return `https://mostaql.com/go/${id}`
}

export function parsePubDate(raw: string | null): { iso: string | null; raw: string | null } {
  if (!raw) return { iso: null, raw: null }
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return { iso: null, raw: raw.slice(0, 200) }
  return { iso: new Date(t).toISOString(), raw: raw.slice(0, 200) }
}

export function cleanExcerpt(htmlOrText: string, maxLen = 2000): string {
  // Descriptions arrive as text; strip any markup defensively, keep it plain.
  const noTags = htmlOrText.replace(/<[^>]*>/g, ' ')
  const decoded = noTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
  return decoded.replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

export interface NormalizeOutcome {
  valid: NormalizedItem[]
  /** single bad entries are isolated and counted, never dropping the batch */
  invalidSingles: number
}

/** A feed cycle with zero *valid* items is a cycle failure, not "no projects". */
export function normalizeItems(raw: RawRssItem[]): NormalizeOutcome {
  const valid: NormalizedItem[] = []
  let invalidSingles = 0
  for (const r of raw) {
    const url = canonicalUrl(r.link)
    const externalId = extractExternalId(r.link)
    const title = r.title.replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!url || !externalId || title.length === 0) {
      invalidSingles++
      continue
    }
    const pub = parsePubDate(r.pubDateRaw)
    valid.push({
      invalid: false,
      source: SOURCE,
      externalId,
      url,
      title,
      descriptionExcerpt: cleanExcerpt(r.description),
      publishedAt: pub.iso,
      publishedRaw: pub.raw
    })
  }
  return { valid, invalidSingles }
}
