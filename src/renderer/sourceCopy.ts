import type { Lang } from './i18n.js'

export function sourceName(source: string, lang: Lang): string {
  if (source === 'khamsat') return lang === 'ar' ? 'خمسات' : 'Khamsat'
  if (source === 'nafezly') return lang === 'ar' ? 'نفذلي' : 'Nafezly'
  if (source === 'mostaql') return lang === 'ar' ? 'مستقل' : 'Mostaql'
  return source
}

export function openOnSource(source: string, lang: Lang): string {
  return lang === 'ar' ? `فتح على ${sourceName(source, lang)}` : `Open on ${sourceName(source, lang)}`
}
