import { kafBudget, kafText } from './kaf.js'
import { parseFactDuration } from './projectFacts.js'

// Bound blocks by their verified heading, so competing proposals and modals never enter the body.
export function parseKafDetails(html: string): { text: string; truncated: boolean; categoryName: string | null; durationDays: number | null; durationRaw: string | null; publicationRaw: string | null; budgetMin: number | null; budgetMax: number | null; budgetRaw: string | null } {
  html = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
  const block = /تفاصيل المشروع\s*<\/p>\s*<\/div>\s*<div\b[^>]*class=["']has-padding["'][^>]*>/.exec(html)
  if (!block) throw Error('kaf-description-missing')
  const start = block.index + block[0].length, tags = /<\/?div\b[^>]*>/gi
  tags.lastIndex = start
  let depth = 1, end: number | null = null, tag: RegExpExecArray | null
  while ((tag = tags.exec(html))) {
    depth += tag[0][1] === '/' ? -1 : 1
    if (depth === 0) { end = tag.index; break }
    if (depth > 100) throw Error('kaf-description-depth')
  }
  if (end === null) throw Error('kaf-description-unclosed')
  const body = html.slice(start, end)
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(p => kafText(p[1])).filter(Boolean)
  const fullText = paragraphs.join('\n\n'), text = fullText.slice(0, 20000)
  if (!text) throw Error('kaf-description-empty')
  const table = html.match(/معلومات المشروع[\s\S]*?<table\b[^>]*class=["']info-table["'][^>]*>([\s\S]*?)<\/table>/)?.[1] ?? ''
  const values = new Map([...table.matchAll(/<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g)].map(m => [kafText(m[1]), kafText(m[2])]))
  const raw = values.get('مدة المشروع') ?? null
  const header = html.slice(0, html.indexOf('تفاصيل المشروع'))
  const publicationRaw = header.match(/<span\b[^>]*title=["'](\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})["'][^>]*>\s*<i\b[^>]*fa-clock/)?.[1] ?? null
  const categoryName = kafText(header.match(/<a\b[^>]*href=["']https:\/\/kafiil\.com\/projects\?category_id=\d+["'][^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '') || null
  const budget = kafBudget(values.get('الميزانية') ?? '')
  return { text, truncated: fullText.length > 20000, categoryName, durationRaw: raw, durationDays: parseFactDuration(raw), publicationRaw, budgetMin: budget.min, budgetMax: budget.max, budgetRaw: values.get('الميزانية') ?? null }
}
