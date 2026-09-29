// Nafezly advertises this public RSS feed from its projects page.
// No account, browser session, scripts, or project-detail requests are used.
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { UpsertInput } from '../storage/repositories.js'
import { foldForSearch } from '../shared/filters.js'

export const NAFEZLY_SOURCE = 'nafezly'
export const NAFEZLY_FEED_URL = 'https://nafezly.com/feed'
const MAX_FEED_BYTES = 512 * 1024
const parser = new XMLParser({ ignoreAttributes: true, trimValues: false })

export interface NafezlyItem extends UpsertInput {
  fullDescription: string
  descriptionTruncated: boolean
}

export interface NafezlyFetchResult {
  ok: boolean
  xml?: string
  status: number | null
  durationMs: number
  retryAfterMs: number | null
  error?: string
}

function retryAfterMs(raw: string | null): number | null {
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400_000, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.min(86_400_000, Math.max(0, date - Date.now())) : null
}

export async function fetchNafezlyFeed(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<NafezlyFetchResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const cancel = (): void => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await fetchImpl(NAFEZLY_FEED_URL, { signal: controller.signal, redirect: 'follow' })
    const retry = retryAfterMs(response.headers.get('retry-after'))
    if (!response.ok) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: retry, error: `HTTP ${response.status}` }
    if (response.url && new URL(response.url).origin !== new URL(NAFEZLY_FEED_URL).origin) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'unexpected redirect' }
    if (!/^(?:application\/rss\+xml|application\/xml|text\/xml)\b/i.test(response.headers.get('content-type') ?? '')) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'unexpected content type' }
    const reader = response.body?.getReader()
    if (!reader) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'empty response' }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        size += value.byteLength
        if (size > MAX_FEED_BYTES) {
          await reader.cancel().catch(() => undefined)
          return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'response too large' }
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const xml = new TextDecoder().decode(bytes)
    if (!xml.trim()) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'empty response' }
    return { ok: true, xml, status: response.status, durationMs: Date.now() - started, retryAfterMs: null }
  } catch (error) {
    return { ok: false, status: null, durationMs: Date.now() - started, retryAfterMs: null, error: error instanceof Error ? error.name : 'network' }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object' && '#text' in v) return text((v as Record<string, unknown>)['#text'])
  return ''
}

function plain(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\r\n?/g, '\n').trim()
}

export function parseNafezlyFeed(xml: string): NafezlyItem[] {
  // The public feed currently includes a newline before its XML declaration.
  const normalized = xml.trimStart()
  if (XMLValidator.validate(normalized) !== true) throw new Error('nafezly-invalid-xml')
  const doc = parser.parse(normalized) as { rss?: { channel?: Record<string, unknown> } }
  const channel = doc?.rss?.channel
  if (!channel || !/nafezly/i.test(text(channel['title']))) throw new Error('nafezly-invalid-channel')
  const raw = channel['item']
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (entries.length === 0) throw new Error('nafezly-empty-feed')
  const items: NafezlyItem[] = []
  const seen = new Set<string>()
  for (const entry of entries.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const title = plain(text(row['title'])).slice(0, 500)
    const rawLink = text(row['link'])
    let url: URL
    try { url = new URL(rawLink) } catch { continue }
    if (url.protocol !== 'https:' || url.hostname !== 'nafezly.com' || url.username || url.password || url.search || url.hash) continue
    const id = /^\/project\/(\d+)(?:-[^/]*)?\/?$/.exec(url.pathname)?.[1]
    if (!id || seen.has(id) || !title) continue
    const rawDate = text(row['pubDate']).trim()
    const dateMs = Date.parse(rawDate)
    if (!rawDate || !Number.isFinite(dateMs)) continue
    const description = plain(text(row['description']))
    const fullDescription = description.slice(0, 30_000)
    seen.add(id)
    items.push({
      source: NAFEZLY_SOURCE,
      externalId: id,
      url: url.href,
      title,
      descriptionExcerpt: fullDescription.slice(0, 1200),
      fullDescription,
      descriptionTruncated: description.length > fullDescription.length,
      publishedAt: new Date(dateMs).toISOString(),
      publishedRaw: rawDate
    })
  }
  if (items.length === 0 || items.length < Math.ceil(entries.length * 0.8)) throw new Error('nafezly-invalid-items')
  return items
}

export function matchesNafezlyKeywords(title: string, description: string, any: string[], exclude: string[]): boolean {
  const content = foldForSearch(`${title}\n${description}`)
  if (exclude.some(value => value.trim() && content.includes(foldForSearch(value.trim())))) return false
  return any.length === 0 || any.some(value => value.trim() && content.includes(foldForSearch(value.trim())))
}
