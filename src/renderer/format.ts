import { STRINGS, fmt, type Lang } from './i18n.js'

export function timeAgo(iso: string | null, lang: Lang): string {
  const t = STRINGS[lang]
  if (!iso) return t.unknownTime
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return t.unknownTime
  if (ms < 60_000) return t.justNow
  const m = Math.floor(ms / 60_000)
  if (m < 60) return fmt(t.minutesAgo, { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return fmt(t.hoursAgo, { n: h })
  return fmt(t.daysAgo, { n: Math.floor(h / 24) })
}

export function fullDate(iso: string | null, lang: Lang): string {
  if (!iso) return STRINGS[lang].unknownTime
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function countdownTo(iso: string | null, lang: Lang): string {
  if (!iso) return '…'
  const ms = Date.parse(iso) - Date.now()
  if (Number.isNaN(ms) || ms <= 1000) return '…'
  return fmt(STRINGS[lang].inSeconds, { n: Math.ceil(ms / 1000) })
}

export function budgetLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  const f = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))
  if (min !== null && max !== null) return min === max ? `$${f(min)}` : `$${f(min)} – $${f(max)}`
  const one = (min ?? max) as number
  return `$${f(one)}`
}
