// Mostaql RSS adapter: anonymous fetch + strict validation + XML parsing.
// No cookies, no account, no JS execution. Unexpected bodies (HTML challenge,
// empty, oversized) are explicit failures — never an empty "no projects" list.

import { XMLParser } from 'fast-xml-parser'

export const RSS_URL = 'https://mostaql.com/rss'
export const FETCH_TIMEOUT_MS = 10_000
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const RSS_USER_AGENT = 'RASED/0.1 (+local Windows watcher; contact via mostaql.com)'

export type FetchErrorKind = 'timeout' | 'cancelled' | 'http' | 'network' | 'too_large' | 'invalid_content'

export interface FetchOk {
  ok: true
  xml: string
  status: number
  durationMs: number
}

export interface FetchFail {
  ok: false
  kind: FetchErrorKind
  status: number | null
  durationMs: number
  retryAfterMs: number | null
  detail: string
}

export type FetchResult = FetchOk | FetchFail

export interface FetchOptions {
  timeoutMs?: number
  maxBytes?: number
  /** injectable for tests */
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  processEntities: true,
  // Never resolve external entities / DTD resources: untrusted input.
  allowBooleanAttributes: false
})

export function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) return null
  const v = value.trim()
  if (/^\d+$/.test(v)) {
    const s = Number(v)
    if (s >= 0 && s <= 86400 * 7) return s * 1000
    return null
  }
  const t = Date.parse(v)
  if (!Number.isNaN(t)) {
    const diff = t - nowMs
    if (diff > 0 && diff <= 86400 * 7 * 1000) return diff
  }
  return null
}

function contentTypeLooksXml(headers: Headers, bodyStart: string): boolean {
  const ct = (headers.get('content-type') ?? '').toLowerCase()
  if (ct.includes('xml') || ct.includes('rss')) return true
  // Some servers omit/mislabel the type; accept an obvious XML document…
  if (bodyStart.startsWith('<?xml') || bodyStart.startsWith('<rss') || bodyStart.startsWith('<feed')) return true
  return false
}

/** Reject documents that could carry entity-expansion / external-resource attacks. */
export function hasDangerousDoctype(xml: string): boolean {
  const m = xml.match(/<!DOCTYPE[^>]*>/i)
  if (!m) return false
  const d = m[0]
  return /ENTITY|SYSTEM|PUBLIC/i.test(d)
}

export async function fetchRss(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES
  const impl = opts.fetchImpl ?? fetch
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const cancel = (): void => ctrl.abort()
  opts.signal?.addEventListener('abort', cancel, { once: true })
  try {
    const res = await impl(url, {
        method: 'GET',
        headers: { 'User-Agent': RSS_USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml;q=0.9' },
        redirect: 'follow',
        signal: ctrl.signal
      })
    const durationMs = Date.now() - started
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'), Date.now())
      return { ok: false, kind: 'http', status: res.status, durationMs, retryAfterMs, detail: `HTTP ${res.status}` }
    }
    const lenHeader = res.headers.get('content-length')
    if (lenHeader && /^\d+$/.test(lenHeader.trim()) && Number(lenHeader) > maxBytes) {
      return { ok: false, kind: 'too_large', status: res.status, durationMs, retryAfterMs: null, detail: `content-length ${lenHeader} exceeds cap` }
    }
    // Stream with a hard cap so a lying/missing length can't blow memory.
    const reader = res.body?.getReader()
    if (!reader) {
      return { ok: false, kind: 'invalid_content', status: res.status, durationMs, retryAfterMs: null, detail: 'empty body' }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          try {
            await reader.cancel()
          } catch {
            /* ignore */
          }
          return { ok: false, kind: 'too_large', status: res.status, durationMs: Date.now() - started, retryAfterMs: null, detail: `body exceeds ${maxBytes} bytes` }
        }
        chunks.push(value)
      }
    }
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      buf.set(c, off)
      off += c.byteLength
    }
    const xml = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (xml.length === 0 || hasDangerousDoctype(xml)) {
      return { ok: false, kind: 'invalid_content', status: res.status, durationMs: Date.now() - started, retryAfterMs: null, detail: xml.length === 0 ? 'empty body' : 'doctype with entities rejected' }
    }
    const head = xml.slice(0, 200).trimStart().toLowerCase()
    if (!contentTypeLooksXml(res.headers, head)) {
      return { ok: false, kind: 'invalid_content', status: res.status, durationMs: Date.now() - started, retryAfterMs: null, detail: 'not an XML document (possible challenge page)' }
    }
    return { ok: true, xml, status: res.status, durationMs: Date.now() - started }
  } catch (err) {
    const kind = opts.signal?.aborted ? 'cancelled' : ctrl.signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) ? 'timeout' : 'network'
    return { ok: false, kind, status: null, durationMs: Date.now() - started, retryAfterMs: null, detail: err instanceof Error ? err.message.slice(0, 300) : 'network error' }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

export interface RawRssItem {
  title: string
  link: string
  description: string
  pubDateRaw: string | null
}

export function parseRssItems(xml: string): { items: RawRssItem[]; invalidSingles: number } {
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch {
    throw new Error('rss-xml-parse-failed')
  }
  if (typeof doc !== 'object' || doc === null) throw new Error('rss-no-document')
  const rss = (doc as Record<string, unknown>)['rss']
  const channel = typeof rss === 'object' && rss !== null ? (rss as Record<string, unknown>)['channel'] : undefined
  if (typeof channel !== 'object' || channel === null) throw new Error('rss-no-channel')
  const raw = (channel as Record<string, unknown>)['item']
  const arr = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  const items: RawRssItem[] = []
  let invalidSingles = 0
  for (const entry of arr) {
    if (typeof entry !== 'object' || entry === null) {
      invalidSingles++
      continue
    }
    const e = entry as Record<string, unknown>
    const title = textOf(e['title'])
    const link = textOf(e['link'])
    if (!title || !link) {
      invalidSingles++
      continue
    }
    items.push({ title, link, description: textOf(e['description']) ?? '', pubDateRaw: textOf(e['pubDate']) })
  }
  // This feed always carries ~20 items; a document with zero *valid* entries
  // is a structural failure (format change, challenge page that slipped
  // through, truncated body) — never a quiet "no projects" signal.
  if (items.length === 0) throw new Error('rss-no-valid-items')
  return { items, invalidSingles }
}

function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && v !== null) {
    // fast-xml-parser may nest CDATA under '#text' or similar; join string leaves.
    const parts: string[] = []
    for (const val of Object.values(v as Record<string, unknown>)) {
      if (typeof val === 'string') parts.push(val)
    }
    if (parts.length > 0) return parts.join(' ')
  }
  return null
}
