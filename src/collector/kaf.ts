import type { UpsertInput } from '../storage/repositories.js'
import { foldForSearch } from '../shared/filters.js'

export const KAF_SOURCE = 'kaf'
export const KAF_ORIGIN = 'https://kafiil.com'
export interface KafItem extends UpsertInput {
  platformStatus: 'open' | 'completed' | 'closed' | 'in-progress' | 'unknown'
  budgetMin: number | null
  budgetMax: number | null
  budgetRaw: string | null
  skills: string[]
}

export function isKafProjectUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.origin === KAF_ORIGIN && !u.username && !u.password && !u.search && !u.hash && /^\/project\/[1-9]\d*(?:-[^/]*)?\/?$/.test(u.pathname) } catch { return false }
}
export function kafText(html: string = ''): string {
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));|&(amp|lt|gt|quot|apos|nbsp);/gi, (m, hex, dec, named) => {
      if (hex || dec) { const n = parseInt(hex || dec, hex ? 16 : 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ' }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[String(named).toLowerCase()] ?? m
    }).replace(/[\u200b\u200e\u200f]/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}
export function kafBudget(raw: string): { min: number | null; max: number | null } {
  const m = /^\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)$/.exec(raw.trim())
  const min = m ? Number(m[1]) : NaN, max = m ? Number(m[2]) : NaN
  return Number.isFinite(min) && min > 0 && max >= min && max < 1e9 ? { min, max } : { min: null, max: null }
}
export function parseKafList(html: string): KafItem[] {
  if (!/id=["']projects["']/.test(html)) throw Error('kaf-container-missing')
  const blocks = html.split(/<div\b[^>]*class=["']project-box(?:\s[^"']*)?["'][^>]*>/i).slice(1)
  if (!blocks.length) throw Error('kaf-empty-or-challenged')
  if (blocks.length > 100) throw Error('kaf-too-many-cards')
  const seen = new Set<string>()
  return blocks.map(block => {
    const a = /<a\b[^>]*href=["']([^"']*\/project\/([1-9]\d*)-[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!a?.[1] || !a[2] || !a[3] || !isKafProjectUrl(a[1]) || seen.has(a[2])) throw Error('kaf-invalid-card')
    const status = kafText(a[3].match(/<span\b[^>]*class=["'][^"']*tag[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '')
    const title = kafText(a[3].replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, '')).slice(0, 500)
    const relative = kafText(block.match(/<i\b[^>]*class=["']far fa-clock["'][^>]*><\/i>([\s\S]*?)<\/span>/i)?.[1] ?? '')
    if (!title || !status || !relative) throw Error('kaf-required-field-missing')
    const raw = kafText(block.match(/<p\b[^>]*class=["']price["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '')
    const budget = kafBudget(raw)
    seen.add(a[2])
    return { source: KAF_SOURCE, externalId: a[2], url: a[1], title,
      publishedAt: null, publishedRaw: relative,
      platformStatus: ({ 'مفتوح': 'open', 'مكتمل': 'completed', 'مغلق': 'closed', 'قيد التنفيذ': 'in-progress' } as const)[status as 'مفتوح'] ?? 'unknown',
      descriptionExcerpt: kafText(block.match(/<p\b[^>]*class=["']info-content["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '').slice(0, 1200),
      budgetMin: budget.min, budgetMax: budget.max, budgetRaw: raw || null,
      skills: [...new Set([...block.matchAll(/<a\b[^>]*class=["']hashtag["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => kafText(m[1])).filter(Boolean))].slice(0, 100) }
  })
}
export function matchesKafKeywords(title: string, excerpt: string, any: string[], exclude: string[]): boolean {
  const text = foldForSearch(`${title}\n${excerpt}`)
  return !exclude.some(v => v.trim() && text.includes(foldForSearch(v))) && (!any.length || any.some(v => v.trim() && text.includes(foldForSearch(v))))
}

export class KafFetchError extends Error {
  constructor(public kind: 'network' | 'timeout' | 'http5xx' | 'forbidden' | 'rate_limited' | 'invalid_content' | 'too_large', public status: number | null = null, public retryAfterMs: number | null = null) { super(`kaf-${kind}${status ? `-${status}` : ''}`) }
}
export async function fetchKafHtml(url: string, signal: AbortSignal, fragment = false, fetchImpl: typeof fetch = fetch): Promise<string> {
  const allowed = isKafProjectUrl(url) || /^https:\/\/kafiil\.com\/projects\?sort=latest&page=[1-9]\d{0,2}$/.test(url)
  if (!allowed) throw new KafFetchError('invalid_content')
  const controller = new AbortController(), abort = (): void => controller.abort()
  const timer = setTimeout(abort, 10000)
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  try {
    const r = await fetchImpl(url, { signal: controller.signal, redirect: 'manual', headers: fragment ? { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' } : { Accept: 'text/html' } })
    const raw = r.headers.get('retry-after'), seconds = raw !== null && /^\d+$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - Date.now() : NaN
    const retry = Number.isFinite(seconds) ? Math.min(86400000, Math.max(0, seconds)) : null
    if (!r.ok) { await r.body?.cancel(); throw new KafFetchError(r.status === 429 ? 'rate_limited' : r.status === 401 || r.status === 403 ? 'forbidden' : r.status >= 500 ? 'http5xx' : 'invalid_content', r.status, retry) }
    if (r.url && r.url !== url || !/text\/html/i.test(r.headers.get('content-type') ?? '')) { await r.body?.cancel(); throw new KafFetchError('invalid_content', r.status) }
    const reader = r.body?.getReader(); if (!reader) throw new KafFetchError('invalid_content')
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1048576) { await reader.cancel(); throw new KafFetchError('too_large') }; chunks.push(value) }
    if (controller.signal.aborted) throw new KafFetchError('timeout')
    const html = Buffer.concat(chunks).toString('utf8')
    if (/cf-chl-|challenge-form|<title>\s*Just a moment/i.test(html)) throw new KafFetchError('forbidden', r.status)
    return html
  } catch (e) { if (e instanceof KafFetchError) throw e; throw new KafFetchError(controller.signal.aborted ? 'timeout' : 'network') }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}

export async function fetchKafPage(page: number, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<{ items: KafItem[]; hasNext: boolean }> {
  const url = `${KAF_ORIGIN}/projects?sort=latest&page=${page}`
  let html = await fetchKafHtml(url, signal, true, fetchImpl)
  let items: KafItem[]
  try { items = parseKafList(html) } catch {
    // A verified page may stop supporting fragments. Never retry an access challenge.
    if (/<!doctype|<html\b/i.test(html) || !/id=["']projects["']/.test(html)) throw new KafFetchError('invalid_content')
    html = await fetchKafHtml(url, signal, false, fetchImpl)
    try { items = parseKafList(html) } catch { throw new KafFetchError('invalid_content') }
  }
  return { items, hasNext: new RegExp(`\\bpage=["']${page + 1}["']`).test(html) }
}
