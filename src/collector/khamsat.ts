// Public Khamsat community listing. Read-only: no account, cookies, scripts,
// comments, or automated interaction with a request.
import type { UpsertInput } from '../storage/repositories.js'
import { foldForSearch } from '../shared/filters.js'

export const KHAMSAT_SOURCE = 'khamsat'
export const KHAMSAT_REQUESTS_URL = 'https://khamsat.com/community/requests'
const MAX_HTML_BYTES = 1024 * 1024

export interface KhamsatFetchResult {
  ok: boolean
  html?: string
  status: number | null
  durationMs: number
  retryAfterMs: number | null
  error?: string
}

export async function fetchKhamsatRequests(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<KhamsatFetchResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  const cancel = (): void => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await fetchImpl(KHAMSAT_REQUESTS_URL, { signal: controller.signal, redirect: 'follow' })
    const retryAfter = response.headers.get('retry-after')
    const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(Number(retryAfter) * 1000, 86_400_000) : null
    if (!response.ok) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs, error: `HTTP ${response.status}` }
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'unexpected content type' }
    const reader = response.body?.getReader()
    if (!reader) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'empty response' }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        size += value.byteLength
        if (size > MAX_HTML_BYTES) {
          await reader.cancel().catch(() => undefined)
          return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'response too large' }
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const html = new TextDecoder().decode(bytes)
    if (!html.trim()) return { ok: false, status: response.status, durationMs: Date.now() - started, retryAfterMs: null, error: 'empty response' }
    return { ok: true, html, status: response.status, durationMs: Date.now() - started, retryAfterMs: null }
  } catch (error) {
    return { ok: false, status: null, durationMs: Date.now() - started, retryAfterMs: null, error: error instanceof Error ? error.name : 'network' }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

function decodeText(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/&#(?:x([0-9a-f]+)|(\d+));|&(?:amp|lt|gt|quot|apos|nbsp);/gi, (match, hex: string | undefined, dec: string | undefined) => {
    if (hex || dec) {
      const code = Number.parseInt(hex ?? dec ?? '', hex ? 16 : 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' } as Record<string, string>)[match.toLowerCase()] ?? match
  }).replace(/\s+/g, ' ').trim()
}

export function parseKhamsatRequests(html: string): UpsertInput[] {
  if (!html.includes('id="forums_table"') && !html.includes("id='forums_table'")) throw new Error('khamsat-list-structure-missing')
  const rows = [...html.matchAll(/<tr\b[^>]*\bid=["']forum_post-(\d+)["'][^>]*>[\s\S]*?<\/tr>/gi)]
  if (rows.length === 0) throw new Error('khamsat-list-empty-or-challenged')
  const items: UpsertInput[] = []
  const unique = new Set<string>()
  for (const match of rows) {
    const id = match[1]
    const row = match[0]
    const anchor = row.match(/<h3\b[^>]*class=["'][^"']*details-head[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    const time = row.match(/<span\b[^>]*title=["'](\d{2}(?:&#x2F;|&#47;|\/)\d{2}(?:&#x2F;|&#47;|\/)\d{4} \d{2}:\d{2}:\d{2} GMT)["']/i)?.[1]
    if (!id || !anchor?.[1] || !anchor[2] || !time || unique.has(id)) continue
    const url = new URL(decodeText(anchor[1]), KHAMSAT_REQUESTS_URL)
    if (url.protocol !== 'https:' || url.hostname !== 'khamsat.com' || !new RegExp(`^/community/requests/${id}(?:-|/|$)`).test(url.pathname)) continue
    const raw = time.replace(/&#x2F;|&#47;/gi, '/')
    const date = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/)
    if (!date) continue
    const publishedMs = Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1]), Number(date[4]), Number(date[5]), Number(date[6]))
    if (!Number.isFinite(publishedMs)) continue
    const title = decodeText(anchor[2]).slice(0, 500)
    if (!title) continue
    unique.add(id)
    items.push({ source: KHAMSAT_SOURCE, externalId: id, url: url.href, title, descriptionExcerpt: '', publishedAt: new Date(publishedMs).toISOString(), publishedRaw: raw })
  }
  if (items.length === 0 || items.length < Math.ceil(rows.length * 0.8)) throw new Error('khamsat-list-invalid-rows')
  return items
}

/** Old discussions can re-enter page one after comments; first-seen alone is not a new request. */
export function isFreshKhamsatRequest(publishedAt: string | null, lastSuccessAt: string | null, nowMs: number): boolean {
  if (!publishedAt || !lastSuccessAt) return false
  const published = Date.parse(publishedAt)
  const last = Date.parse(lastSuccessAt)
  if (!Number.isFinite(published) || !Number.isFinite(last)) return false
  return published >= Math.max(last - 30_000, nowMs - 30 * 60_000) && published <= nowMs + 120_000
}

export function matchesKhamsatKeywords(title: string, any: string[], exclude: string[]): boolean {
  const text = foldForSearch(title)
  if (exclude.some(word => word.trim() && text.includes(foldForSearch(word.trim())))) return false
  return any.length === 0 || any.some(word => word.trim() && text.includes(foldForSearch(word.trim())))
}
