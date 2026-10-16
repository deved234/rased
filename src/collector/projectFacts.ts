import type { ProjectFactValues } from '../shared/projectFacts.js'
import { extractDivById } from './projectBody.js'

export function factText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_m, hex, dec) => {
      const n = Number.parseInt(hex ?? dec, hex ? 16 : 10)
      return Number.isSafeInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' '
    }).replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_m, name: string) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name.toLowerCase()] ?? ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim()
}
const digits = (value: string): string => value.replace(/[٠-٩۰-۹]/g, ch => String(ch.charCodeAt(0) >= 0x6f0 ? ch.charCodeAt(0) - 0x6f0 : ch.charCodeAt(0) - 0x660)).replace(/٫/g, '.').replace(/[٬,]/g, '')

export function parseFactDuration(raw: string | null): number | null {
  if (!raw) return null
  const value = digits(raw).replace(/[ًٌٍَُِّْ]/g, '')
  const match = /^(\d+)\s*(يوم|يوما|أيام|ايام|days?|أسبوع|اسبوع|أسابيع|اسابيع|weeks?)$/i.exec(value)
  if (!match) return null
  const days = Number(match[1]) * (/أسبوع|اسبوع|أسابيع|اسابيع|week/i.test(match[2]!) ? 7 : 1)
  return Number.isSafeInteger(days) && days > 0 && days <= 3650 ? days : null
}
export function parseFactBudget(raw: string | null): Pick<ProjectFactValues, 'budgetMin' | 'budgetMax' | 'currency'> {
  const empty = { budgetMin: null, budgetMax: null, currency: null }
  if (!raw || !/\$|\bUSD\b|دولار/i.test(raw)) return empty
  const value = digits(raw).replace(/\$|\bUSD\b|دولار(?:ات)?/gi, '').trim()
  const match = /^(\d+(?:\.\d+)?)(?:\s*(?:[-–—]|إلى|الى)\s*(\d+(?:\.\d+)?))?$/.exec(value)
  if (!match) return empty
  const min = Number(match[1]), max = Number(match[2] ?? match[1])
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min && max <= 1e9 ? { budgetMin: min, budgetMax: max, currency: 'USD' } : empty
}

/** Trust labeled metadata rows only, never description text, JSON-LD salary or offers. */
export function parseProjectFacts(html: string, source: 'mostaql' | 'nafezly'): ProjectFactValues | null {
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  let area = clean
  if (source === 'mostaql') area = extractDivById(clean, 'project-meta-panel') ?? clean
  else {
    const heading = /<div\b[^>]*>\s*بطاقة المشروع\s*<\/div>/i.exec(clean)
    if (!heading) return null
    const start = heading.index + heading[0].length
    const wrapper = /<div\b[^>]*class=["'](?=[^"']*\bcol-12\b)(?=[^"']*\brow\b)(?=[^"']*\bp-3\b)[^"']*["'][^>]*>/i.exec(clean.slice(start, start + 2000))
    if (!wrapper) return null
    const contentStart = start + wrapper.index + wrapper[0].length
    const tags = /<\/?div\b[^>]*>/gi
    tags.lastIndex = contentStart
    let depth = 1, end: number | null = null, tag: RegExpExecArray | null
    while ((tag = tags.exec(clean))) {
      depth += tag[0][1] === '/' ? -1 : 1
      if (depth === 0) { end = tag.index; break }
      if (depth > 100 || tag.index - contentStart > 18000) return null
    }
    if (end === null) return null
    area = clean.slice(contentStart, end)
  }
  let recognized = false
  const rowValue = (label: string): string | null => {
    const pattern = new RegExp(`<div\\b[^>]*class=["'][^"']*${source === 'mostaql' ? 'meta-label' : 'col-6'}[^"']*["'][^>]*>\\s*${label}\\s*<\\/div>\\s*<div\\b[^>]*>([\\s\\S]{0,700}?)<\\/div>`, 'i')
    const found = pattern.exec(area)
    if (!found) return null
    recognized = true
    const text = factText(found[1]!).slice(0, 100)
    return /^[-–—]+$/.test(text) ? null : text || null
  }
  let budgetRaw = rowValue('الميزانية')
  const durationRaw = rowValue(source === 'mostaql' ? 'مدة التنفيذ' : 'المدة المتاحة')
  // Legacy Mostaql markup and existing cached-page fixtures use this explicit marker.
  if (source === 'mostaql' && !budgetRaw) {
    const marker = /data-type\s*=\s*(?:["']project-budget_range["']|project-budget_range\b)[^>]*>([\s\S]{0,250}?)<\/div>/i.exec(area)
    if (marker) { recognized = true; budgetRaw = factText(marker[1]!).slice(0, 100) || null }
  }
  if (!recognized) return null
  return { ...parseFactBudget(budgetRaw), budgetRaw, durationRaw, durationDays: parseFactDuration(durationRaw) }
}
