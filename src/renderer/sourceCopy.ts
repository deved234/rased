import type { Lang } from './i18n.js'

export function sourceName(source: string, lang: Lang): string {
  if (source === 'khamsat') return lang === 'ar' ? 'خمسات' : 'Khamsat'
  if (source === 'kaf') return lang === 'ar' ? 'كاف' : 'KAF'
  if (source === 'nafezly') return lang === 'ar' ? 'نفذلي' : 'Nafezly'
  if (source === 'mostaql') return lang === 'ar' ? 'مستقل' : 'Mostaql'
  return source
}

export function openOnSource(source: string, lang: Lang): string {
  return lang === 'ar' ? `فتح على ${sourceName(source, lang)}` : `Open on ${sourceName(source, lang)}`
}

export function platformStatusName(status: string | null | undefined, lang: Lang): string {
  const names: Record<string, [string, string]> = {
    open: ['مفتوح', 'Open'], completed: ['مكتمل', 'Completed'], closed: ['مغلق', 'Closed'],
    'in-progress': ['قيد التنفيذ', 'In progress'], unknown: ['غير معروف', 'Unknown']
  }
  return (names[status ?? 'unknown'] ?? names.unknown)![lang === 'ar' ? 0 : 1]
}
