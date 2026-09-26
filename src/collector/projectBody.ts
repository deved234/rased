// Full project-body extraction from the public detail page.
// Authoritative anchor (verified against a saved real page 2026-09-24):
//   <div id="projectDetailsTab"> … <div class="text-wrapper-div …"> <p>…</p>…
// Only <p> paragraphs inside that tab are trusted; nav/footer/headers never
// leave this function. Output is plain text with paragraphs, never raw HTML.

export type BodyFailure =
  | 'no-description'
  | 'empty'
  | 'too-long'

export interface BodyOk {
  ok: true
  text: string
  paragraphs: number
  truncated: boolean
}

export interface BodyFail {
  ok: false
  error: BodyFailure
}

export type BodyResult = BodyOk | BodyFail

export const MAX_BODY_CHARS = 20_000

/** Extract the inner HTML of <div … id="…"> … </div> with depth counting. */
export function extractDivById(html: string, id: string): string | null {
  const openRe = new RegExp(`<div\\b[^>]*\\bid=(["'])${id}\\1[^>]*>`, 'i')
  const m = openRe.exec(html)
  if (!m || m.index === undefined) return null
  const pos = m.index + m[0].length
  let depth = 1
  const tagRe = /<\/?div\b[^>]*>/gi
  tagRe.lastIndex = pos
  let t: RegExpExecArray | null
  while ((t = tagRe.exec(html)) !== null) {
    if (t[0][1] === '/') {
      depth--
      if (depth === 0) return html.slice(pos, t.index)
    } else {
      depth++
    }
    if (depth > 500) return null
  }
  return null
}

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => {
      const c = Number(n)
      return Number.isFinite(c) && c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : ' '
    })
}

/** Parse full description paragraphs from a detail body. Pure + tested. */
export function parseProjectBody(html: string): BodyResult {
  if (!html || html.length < 500) return { ok: false, error: 'no-description' }
  const tab = extractDivById(html, 'projectDetailsTab')
  if (!tab) return { ok: false, error: 'no-description' }
  const paras: string[] = []
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi
  let m: RegExpExecArray | null
  while ((m = pRe.exec(tab)) !== null) {
    const text = decodeEntities(stripTags(m[1] ?? '')).replace(/\s+/g, ' ').trim()
    if (text.length > 0) paras.push(text)
  }
  if (paras.length === 0) return { ok: false, error: 'empty' }
  const joined = paras.join('\n\n')
  if (joined.length < 20) return { ok: false, error: 'empty' }
  if (joined.length > MAX_BODY_CHARS) {
    return { ok: true, text: joined.slice(0, MAX_BODY_CHARS), paragraphs: paras.length, truncated: true }
  }
  return { ok: true, text: joined, paragraphs: paras.length, truncated: false }
}
