// Keep notification folding stable; general search additionally normalizes spacing.
export function foldForSearch(s: string): string {
  return s.replace(/[ً-ٰٟ]/g, '').replace(/ـ/g, '').replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).toLowerCase()
}

export const SEARCH_NORMALIZATION_VERSION = 1
export function normalizeGeneralSearch(text: string): string {
  // NFC and Arabic substitutions are identities for ASCII. Avoid rescanning
  // large Latin descriptions through every Arabic replacement on cold reads.
  if (/^\p{ASCII}*$/u.test(text)) return text.toLowerCase().replace(/\s+/gu, ' ').trim()
  return foldForSearch(text.normalize('NFC')).replace(/\s+/gu, ' ').trim()
}

export function containsGeneralSearch(text: string, normalizedNeedle: string): boolean {
  // Whitespace folding cannot create/remove a non-whitespace ASCII substring.
  // Return a boolean to SQLite instead of copying a normalized full body back.
  if (!/\s/u.test(normalizedNeedle) && /^\p{ASCII}*$/u.test(text)) return text.toLowerCase().includes(normalizedNeedle)
  return normalizeGeneralSearch(text).includes(normalizedNeedle)
}

export function searchSkills(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const items: unknown = JSON.parse(value)
    return Array.isArray(items) ? items.filter((v): v is string => typeof v === 'string').join(' ') : ''
  } catch { return '' }
}

export type MatchedField = 'title' | 'excerpt' | 'skills' | 'body' | 'note' | 'draft'
